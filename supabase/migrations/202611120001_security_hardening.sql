-- Phase 8: security review fixes.

-- 1. Least privilege for API roles ------------------------------------------------
-- Supabase's default grants include TRUNCATE (which bypasses RLS), TRIGGER, and
-- REFERENCES. None are needed by the app; revoke them now and for future tables.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 2. Documents may only point at their own storage location -------------------------
-- Without this, a member could insert a document row (directly through PostgREST)
-- whose storage_path names another organization's file; the worker, which reads
-- Storage with the service role, would then index that file into the attacker's workspace.
alter table public.documents add constraint documents_storage_path_scope check (
  storage_path like organization_id::text || '/' || workspace_id::text || '/' || id::text || '/%'
  and storage_path !~ '(^|/)\.\.(/|$)'
);

-- 3. Worker-owned columns cannot be set by clients ------------------------------------
-- BEFORE INSERT triggers run before RLS WITH CHECK, so the policies validate the
-- normalized row. The service role and the worker's database connection are unaffected.
create function private.enforce_client_insert_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') in ('anon', 'authenticated') then
    if tg_table_name = 'agent_runs' then
      new.status := 'queued';
      new.model := null;
      new.input_tokens := 0;
      new.output_tokens := 0;
      new.estimated_cost_usd := 0;
      new.retry_count := 0;
      new.started_at := null;
      new.finished_at := null;
      new.error_code := null;
      new.error_message := null;
      new.created_at := now();
      new.updated_at := now();
    elsif tg_table_name = 'documents' then
      new.processing_status := 'uploading';
      new.processing_error := null;
      new.embedding_status := 'pending';
      new.created_at := now();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_client_insert_defaults() from public, anon, authenticated;

create trigger agent_runs_enforce_client_defaults
before insert on public.agent_runs
for each row execute function private.enforce_client_insert_defaults();

create trigger documents_enforce_client_defaults
before insert on public.documents
for each row execute function private.enforce_client_insert_defaults();

-- 4. agent_runs visibility without a self-lookup ---------------------------------------
-- Same rules as can_read_agent_run(), evaluated on the row itself. This avoids one
-- extra query per row and lets INSERT ... RETURNING see the new row.
drop policy agent_runs_select_authorized on public.agent_runs;
create policy agent_runs_select_authorized on public.agent_runs
for select to authenticated
using (
  public.has_org_role(organization_id, array['admin'])
  or (created_by = (select auth.uid()) and public.has_org_role(organization_id, array['member']))
  or (status = 'completed' and public.has_org_role(organization_id, array['viewer']))
);
