create extension if not exists vector with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (char_length(slug) between 2 and 63 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv'
  )),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  checksum text not null check (char_length(checksum) between 32 and 128),
  processing_status text not null default 'uploading'
    check (processing_status in ('uploading', 'queued', 'processing', 'indexed', 'failed')),
  processing_error text,
  created_at timestamptz not null default now(),
  constraint documents_workspace_org_fk
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  check (storage_path = organization_id::text || '/' || workspace_id::text || '/' || id::text || '/' || file_name),
  unique (id, organization_id, workspace_id)
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  document_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) > 0),
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint chunks_document_tenant_fk
    foreign key (document_id, organization_id, workspace_id)
    references public.documents(id, organization_id, workspace_id) on delete cascade,
  unique (document_id, chunk_index)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  objective text not null check (char_length(btrim(objective)) between 1 and 12000),
  status text not null default 'queued'
    check (status in ('queued', 'planning', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_runs_workspace_org_fk
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  unique (id, organization_id, workspace_id)
);

create table public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  run_id uuid not null,
  step_index integer not null check (step_index >= 0),
  step_type text not null check (step_type in ('planning', 'retrieval', 'tool', 'analysis', 'final')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_approval', 'approved', 'rejected', 'completed', 'failed', 'cancelled')),
  tool_name text,
  input_json jsonb,
  output_json jsonb,
  requires_approval boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint steps_run_tenant_fk
    foreign key (run_id, organization_id, workspace_id)
    references public.agent_runs(id, organization_id, workspace_id) on delete cascade,
  unique (run_id, step_index),
  check (
    (approved_by is null and approved_at is null)
    or (approved_by is not null and approved_at is not null and status in ('approved', 'rejected'))
  )
);

create table public.agent_run_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  run_id uuid not null,
  sequence bigint not null check (sequence > 0),
  event_type text not null check (char_length(btrim(event_type)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint events_run_tenant_fk
    foreign key (run_id, organization_id, workspace_id)
    references public.agent_runs(id, organization_id, workspace_id) on delete cascade,
  unique (run_id, sequence)
);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  run_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  artifact_type text not null check (artifact_type in ('report', 'summary', 'analysis', 'other')),
  content_markdown text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artifacts_workspace_org_fk
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint artifacts_run_tenant_fk
    foreign key (run_id, organization_id, workspace_id)
    references public.agent_runs(id, organization_id, workspace_id) on delete set null (run_id),
  unique (id, organization_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 1 and 120),
  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.job_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workspace_id uuid not null,
  run_id uuid,
  document_id uuid,
  job_type text not null check (job_type in ('agent_run', 'document_process')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority smallint not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_workspace_org_fk
    foreign key (workspace_id, organization_id)
    references public.workspaces(id, organization_id) on delete cascade,
  constraint jobs_run_tenant_fk
    foreign key (run_id, organization_id, workspace_id)
    references public.agent_runs(id, organization_id, workspace_id) on delete cascade,
  constraint jobs_document_tenant_fk
    foreign key (document_id, organization_id, workspace_id)
    references public.documents(id, organization_id, workspace_id) on delete cascade,
  check (
    (job_type = 'agent_run' and run_id is not null and document_id is null)
    or (job_type = 'document_process' and document_id is not null and run_id is null)
  ),
  check (
    (status = 'running' and locked_at is not null and locked_by is not null and lease_expires_at is not null)
    or (status <> 'running' and locked_at is null and locked_by is null and lease_expires_at is null)
  )
);
grant select, update on private.job_queue to service_role;

create unique index job_queue_dedupe_key_uidx
  on private.job_queue (dedupe_key) where dedupe_key is not null;
create index job_queue_claim_idx
  on private.job_queue (priority desc, available_at, created_at)
  where status = 'queued';
create index job_queue_expired_lease_idx
  on private.job_queue (lease_expires_at)
  where status = 'running';
create unique index job_queue_run_once_uidx
  on private.job_queue (run_id)
  where run_id is not null;
create index documents_org_workspace_created_idx
  on public.documents (organization_id, workspace_id, created_at desc);
create index documents_status_idx on public.documents (processing_status, created_at desc);
create index document_chunks_tenant_document_idx
  on public.document_chunks (organization_id, workspace_id, document_id, chunk_index);
create index document_chunks_embedding_hnsw_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;
create index agent_runs_tenant_created_idx
  on public.agent_runs (organization_id, workspace_id, created_at desc);
create index agent_runs_status_idx on public.agent_runs (status, created_at desc);
create index agent_run_steps_run_idx on public.agent_run_steps (run_id, step_index);
create index agent_run_events_run_created_idx on public.agent_run_events (run_id, created_at);
create index artifacts_tenant_created_idx
  on public.artifacts (organization_id, workspace_id, created_at desc);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger agent_runs_set_updated_at
before update on public.agent_runs
for each row execute function public.set_updated_at();
create trigger artifacts_set_updated_at
before update on public.artifacts
for each row execute function public.set_updated_at();
create trigger job_queue_set_updated_at
before update on private.job_queue
for each row execute function public.set_updated_at();

create function private.enqueue_agent_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.job_queue (
    organization_id,
    workspace_id,
    run_id,
    job_type,
    payload,
    dedupe_key
  )
  values (
    new.organization_id,
    new.workspace_id,
    new.id,
    'agent_run',
    '{}'::jsonb,
    'agent-run:' || new.id::text
  );

  insert into public.agent_run_events (
    organization_id,
    workspace_id,
    run_id,
    sequence,
    event_type,
    payload
  )
  values (
    new.organization_id,
    new.workspace_id,
    new.id,
    1,
    'run.queued',
    jsonb_build_object('status', new.status)
  );

  return new;
end;
$$;

create trigger agent_runs_enqueue_after_insert
after insert on public.agent_runs
for each row when (new.status = 'queued')
execute function private.enqueue_agent_run();

create function public.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function public.has_workspace_role(p_workspace_id uuid, p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces as workspace
    join public.organization_members as member
      on member.organization_id = workspace.organization_id
    where workspace.id = p_workspace_id
      and workspace.organization_id = p_organization_id
      and member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role = any (p_roles)
  );
$$;

create function public.can_read_agent_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_runs as run
    join public.organization_members as member
      on member.organization_id = run.organization_id
     and member.user_id = (select auth.uid())
    where run.id = p_run_id
      and (
        member.role = 'admin'
        or (member.role = 'member' and run.created_by = (select auth.uid()))
        or (member.role = 'viewer' and run.status = 'completed')
      )
  );
$$;

create function public.can_approve_agent_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agent_runs as run
    join public.organization_members as member
      on member.organization_id = run.organization_id
     and member.user_id = (select auth.uid())
    where run.id = p_run_id
      and (member.role = 'admin' or (member.role = 'member' and run.created_by = (select auth.uid())))
  );
$$;

create function public.create_organization_with_workspace(
  p_organization_name text,
  p_organization_slug text,
  p_workspace_name text,
  p_workspace_description text default null
)
returns table (organization_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_organization_name is null or char_length(btrim(p_organization_name)) not between 2 and 120 then
    raise exception 'Organization name must be between 2 and 120 characters.' using errcode = '22023';
  end if;

  if p_workspace_name is null or char_length(btrim(p_workspace_name)) not between 2 and 120 then
    raise exception 'Workspace name must be between 2 and 120 characters.' using errcode = '22023';
  end if;

  if p_organization_slug is null
    or char_length(p_organization_slug) not between 2 and 63
    or p_organization_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Organization slug must contain lowercase letters, numbers, and single hyphens.' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug)
  values (btrim(p_organization_name), p_organization_slug)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'admin');

  insert into public.workspaces (organization_id, name, description, created_by)
  values (v_organization_id, btrim(p_workspace_name), nullif(btrim(p_workspace_description), ''), v_user_id)
  returning id into v_workspace_id;

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (
    v_organization_id,
    v_user_id,
    'organization.created',
    'organization',
    v_organization_id,
    jsonb_build_object('workspace_id', v_workspace_id)
  );

  return query select v_organization_id, v_workspace_id;
end;
$$;

create function private.claim_agent_jobs(p_worker_id text, p_limit integer default 1)
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
  set status = 'failed',
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      last_error = coalesce(job.last_error, 'Job lease expired after the maximum number of attempts.')
  where job.attempts >= job.max_attempts
    and (
      job.status = 'queued'
      or (job.status = 'running' and job.lease_expires_at <= now())
    );

  return query
  with candidates as (
    select job.id
    from private.job_queue as job
    where (
        (job.status = 'queued' and job.available_at <= now() and job.attempts < job.max_attempts)
        or (job.status = 'running' and job.lease_expires_at <= now() and job.attempts < job.max_attempts)
      )
    order by job.priority desc, job.available_at, job.created_at
    for update skip locked
    limit v_limit
  )
  update private.job_queue as job
  set status = 'running',
      locked_at = now(),
      locked_by = btrim(p_worker_id),
      lease_expires_at = now() + interval '2 minutes',
      attempts = job.attempts + 1,
      last_error = null
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.has_org_role(uuid, text[]) from public, anon;
revoke all on function public.has_workspace_role(uuid, uuid, text[]) from public, anon;
revoke all on function public.can_read_agent_run(uuid) from public, anon;
revoke all on function public.can_approve_agent_run(uuid) from public, anon;
revoke all on function public.create_organization_with_workspace(text, text, text, text) from public, anon;
revoke all on function private.claim_agent_jobs(text, integer) from public, anon, authenticated;
revoke all on function private.enqueue_agent_run() from public, anon, authenticated, service_role;
grant execute on function public.has_org_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, uuid, text[]) to authenticated, service_role;
grant execute on function public.can_read_agent_run(uuid) to authenticated, service_role;
grant execute on function public.can_approve_agent_run(uuid) to authenticated, service_role;
grant execute on function public.create_organization_with_workspace(text, text, text, text) to authenticated;
grant execute on function private.claim_agent_jobs(text, integer) to service_role;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
alter table public.agent_run_events enable row level security;
alter table public.artifacts enable row level security;
alter table public.audit_logs enable row level security;
alter table private.job_queue enable row level security;

create policy organizations_select_member on public.organizations
for select to authenticated using (public.has_org_role(id, array['admin', 'member', 'viewer']));
create policy organizations_update_admin on public.organizations
for update to authenticated
using (public.has_org_role(id, array['admin']))
with check (public.has_org_role(id, array['admin']));

create policy organization_members_select_self_or_admin on public.organization_members
for select to authenticated
using (user_id = (select auth.uid()) or public.has_org_role(organization_id, array['admin']));
create policy organization_members_insert_admin on public.organization_members
for insert to authenticated
with check (public.has_org_role(organization_id, array['admin']));
create policy organization_members_update_admin on public.organization_members
for update to authenticated
using (user_id <> (select auth.uid()) and public.has_org_role(organization_id, array['admin']))
with check (public.has_org_role(organization_id, array['admin']));
create policy organization_members_delete_admin on public.organization_members
for delete to authenticated
using (user_id <> (select auth.uid()) and public.has_org_role(organization_id, array['admin']));

create policy workspaces_select_member on public.workspaces
for select to authenticated
using (public.has_org_role(organization_id, array['admin', 'member', 'viewer']));
create policy workspaces_insert_admin on public.workspaces
for insert to authenticated
with check (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['admin']));
create policy workspaces_update_admin on public.workspaces
for update to authenticated
using (public.has_org_role(organization_id, array['admin']))
with check (public.has_org_role(organization_id, array['admin']));
create policy workspaces_delete_admin on public.workspaces
for delete to authenticated using (public.has_org_role(organization_id, array['admin']));

create policy documents_select_member on public.documents
for select to authenticated
using (public.has_org_role(organization_id, array['admin', 'member', 'viewer']));
create policy documents_insert_contributor on public.documents
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.has_org_role(organization_id, array['admin', 'member'])
);
create policy documents_delete_admin on public.documents
for delete to authenticated using (public.has_org_role(organization_id, array['admin']));

create policy document_chunks_select_member on public.document_chunks
for select to authenticated
using (public.has_org_role(organization_id, array['admin', 'member', 'viewer']));

create policy agent_runs_select_authorized on public.agent_runs
for select to authenticated using (public.can_read_agent_run(id));
create policy agent_runs_insert_contributor on public.agent_runs
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and status = 'queued'
  and public.has_org_role(organization_id, array['admin', 'member'])
);
create policy agent_runs_cancel_authorized on public.agent_runs
for update to authenticated
using (
  (public.has_org_role(organization_id, array['admin']))
  or (
    created_by = (select auth.uid())
    and status in ('queued', 'planning', 'running', 'waiting_approval')
    and public.has_org_role(organization_id, array['member'])
  )
)
with check (
  status = 'cancelled'
  and (
    public.has_org_role(organization_id, array['admin'])
    or (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['member']))
  )
);

create policy agent_run_steps_select_authorized on public.agent_run_steps
for select to authenticated using (public.can_read_agent_run(run_id));
create policy agent_run_steps_approval_decision on public.agent_run_steps
for update to authenticated
using (
  requires_approval
  and status = 'waiting_approval'
  and public.can_approve_agent_run(run_id)
)
with check (
  requires_approval
  and status in ('approved', 'rejected')
  and approved_by = (select auth.uid())
  and approved_at is not null
  and public.can_approve_agent_run(run_id)
);

create policy agent_run_events_select_authorized on public.agent_run_events
for select to authenticated using (public.can_read_agent_run(run_id));

create policy artifacts_select_member on public.artifacts
for select to authenticated
using (public.has_org_role(organization_id, array['admin', 'member', 'viewer']));
create policy artifacts_insert_contributor on public.artifacts
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.has_org_role(organization_id, array['admin', 'member'])
  and (run_id is null or public.can_read_agent_run(run_id))
);
create policy artifacts_update_owner_or_admin on public.artifacts
for update to authenticated
using (
  public.has_org_role(organization_id, array['admin'])
  or (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['member']))
)
with check (
  public.has_org_role(organization_id, array['admin'])
  or (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['member']))
);
create policy artifacts_delete_owner_or_admin on public.artifacts
for delete to authenticated
using (
  public.has_org_role(organization_id, array['admin'])
  or (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['member']))
);

create policy audit_logs_select_admin on public.audit_logs
for select to authenticated using (public.has_org_role(organization_id, array['admin']));

grant select, update on public.organizations to authenticated;
grant select, insert, delete on public.organization_members to authenticated;
grant update (role) on public.organization_members to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert (organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum), delete
  on public.documents to authenticated;
grant select on public.document_chunks to authenticated;
grant select, insert (organization_id, workspace_id, created_by, title, objective, model), update (status)
  on public.agent_runs to authenticated;
grant select on public.agent_run_steps to authenticated;
grant update (status, approved_by, approved_at) on public.agent_run_steps to authenticated;
grant select on public.agent_run_events to authenticated;
grant select, insert, update, delete on public.artifacts to authenticated;
grant select on public.audit_logs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-documents',
  'workspace-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy workspace_documents_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'workspace-documents'
  and (case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 1)::uuid end) is not null
  and (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end) is not null
  and public.has_workspace_role(
    (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid end),
    (case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid end),
    array['admin', 'member', 'viewer']
  )
);
create policy workspace_documents_insert_contributor on storage.objects
for insert to authenticated
with check (
  bucket_id = 'workspace-documents'
  and (case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 1)::uuid end) is not null
  and (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end) is not null
  and public.has_workspace_role(
    (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid end),
    (case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid end),
    array['admin', 'member']
  )
);
create policy workspace_documents_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'workspace-documents'
  and (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(name, '/', 2)::uuid end) is not null
  and public.has_workspace_role(
    (case when split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 2)::uuid end),
    (case when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(name, '/', 1)::uuid end),
    array['admin']
  )
);
