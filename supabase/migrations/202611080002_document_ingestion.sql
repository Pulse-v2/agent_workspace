alter table public.documents
  add column embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'completed', 'unavailable', 'failed'));

create table public.document_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  document_id uuid not null,
  row_index integer not null check (row_index > 0),
  row_data jsonb not null,
  created_at timestamptz not null default now(),
  constraint document_rows_document_tenant_fk
    foreign key (document_id, organization_id, workspace_id)
    references public.documents(id, organization_id, workspace_id) on delete cascade,
  unique (document_id, row_index)
);
alter table public.document_rows enable row level security;
create policy document_rows_select_member on public.document_rows
for select to authenticated
using (public.has_org_role(organization_id, array['admin', 'member', 'viewer']));
grant select on public.document_rows to authenticated;
create index document_rows_document_idx on public.document_rows(document_id, row_index);
create unique index documents_workspace_checksum_uidx on public.documents(workspace_id, checksum);

create function private.enqueue_document_processing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.processing_status = 'uploading' then
    update public.documents set processing_status = 'queued' where id = new.id;
    insert into private.job_queue (
      organization_id, workspace_id, document_id, job_type, dedupe_key
    ) values (
      new.organization_id, new.workspace_id, new.id, 'document_process', 'document:' || new.id::text
    );
  end if;
  return new;
end;
$$;
create trigger documents_enqueue_processing_after_insert
after insert on public.documents
for each row execute function private.enqueue_document_processing();

create function private.claim_document_jobs(p_worker_id text, p_limit integer default 1)
returns setof private.job_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 25));
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 then
    raise exception 'Worker ID must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  update private.job_queue as job
  set status = 'failed', locked_at = null, locked_by = null, lease_expires_at = null,
      last_error = coalesce(job.last_error, 'Job lease expired after the maximum number of attempts.')
  where job.job_type = 'document_process' and job.attempts >= job.max_attempts
    and (job.status = 'queued' or (job.status = 'running' and job.lease_expires_at <= now()));
  return query
  with candidates as (
    select job.id from private.job_queue as job
    where job.job_type = 'document_process' and job.attempts < job.max_attempts
      and ((job.status = 'queued' and job.available_at <= now())
        or (job.status = 'running' and job.lease_expires_at <= now()))
    order by job.priority desc, job.available_at, job.created_at
    for update skip locked limit v_limit
  )
  update private.job_queue as job
  set status = 'running', locked_at = now(), locked_by = btrim(p_worker_id),
      lease_expires_at = now() + interval '2 minutes', attempts = job.attempts + 1,
      last_error = null, updated_at = now()
  from candidates where job.id = candidates.id returning job.*;
end;
$$;

create function public.retry_document_processing(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  select * into v_document from public.documents where id = p_document_id for update;
  if not found or not public.has_org_role(v_document.organization_id, array['admin', 'member']) then
    raise exception 'Document is not available for retry.' using errcode = '42501';
  end if;
  if v_document.processing_status <> 'failed' then
    raise exception 'Only failed documents can be retried.' using errcode = '22023';
  end if;
  update public.documents
  set processing_status = 'queued', processing_error = null, embedding_status = 'pending'
  where id = p_document_id;
  insert into private.job_queue (organization_id, workspace_id, document_id, job_type, dedupe_key)
  values (v_document.organization_id, v_document.workspace_id, p_document_id, 'document_process',
    'document:' || p_document_id::text || ':retry:' || floor(extract(epoch from clock_timestamp()))::text);
end;
$$;

create function public.match_document_chunks(
  p_organization_id uuid,
  p_workspace_id uuid,
  p_embedding extensions.vector(1536),
  p_match_threshold real default 0.35,
  p_match_count integer default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  file_name text,
  content text,
  similarity real,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select chunk.id, document.id, document.file_name, chunk.content,
    1 - (chunk.embedding OPERATOR(extensions.<=>) p_embedding), chunk.metadata
  from public.document_chunks as chunk
  join public.documents as document
    on document.id = chunk.document_id
   and document.organization_id = chunk.organization_id
   and document.workspace_id = chunk.workspace_id
  where chunk.organization_id = p_organization_id
    and chunk.workspace_id = p_workspace_id
    and chunk.embedding is not null
    and public.has_workspace_role(p_workspace_id, p_organization_id, array['admin', 'member', 'viewer'])
    and 1 - (chunk.embedding OPERATOR(extensions.<=>) p_embedding) >= greatest(-1, least(1, p_match_threshold))
  order by chunk.embedding OPERATOR(extensions.<=>) p_embedding
  limit greatest(1, least(50, p_match_count));
$$;

revoke all on function private.enqueue_document_processing() from public, anon, authenticated, service_role;
revoke all on function private.claim_document_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.retry_document_processing(uuid) from public, anon;
revoke all on function public.match_document_chunks(uuid, uuid, extensions.vector, real, integer) from public, anon;
grant execute on function public.retry_document_processing(uuid) to authenticated;
grant execute on function public.match_document_chunks(uuid, uuid, extensions.vector, real, integer) to authenticated;
grant execute on function private.claim_document_jobs(text, integer) to service_role;
