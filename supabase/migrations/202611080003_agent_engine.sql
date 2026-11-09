-- Phase 4: agent execution engine support.
--
-- * Initial run event uses the documented event vocabulary (run_created).
-- * Agent jobs get their own claim function that also fails runs whose
--   leases expired after the final attempt.
-- * Workers renew leases with heartbeats.
-- * Run events receive a gap-free, per-run monotonically increasing sequence.
-- * Cancellation is only possible through cancel_agent_run(), which keeps the
--   run, its job, its steps, and its event stream consistent.

create or replace function private.enqueue_agent_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.job_queue (organization_id, workspace_id, run_id, job_type, payload, dedupe_key)
  values (new.organization_id, new.workspace_id, new.id, 'agent_run', '{}'::jsonb, 'agent-run:' || new.id::text);

  insert into public.agent_run_events (organization_id, workspace_id, run_id, sequence, event_type, payload)
  values (new.organization_id, new.workspace_id, new.id, 1, 'run_created', jsonb_build_object('status', new.status));

  return new;
end;
$$;

create or replace function private.claim_agent_jobs(p_worker_id text, p_limit integer default 1)
returns setof private.job_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 25));
  v_exhausted record;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 120 then
    raise exception 'Worker ID must be between 1 and 120 characters.' using errcode = '22023';
  end if;

  -- Jobs whose final lease expired (worker crash on the last attempt) fail permanently.
  for v_exhausted in
    update private.job_queue as job
    set status = 'failed', locked_at = null, locked_by = null, lease_expires_at = null,
        last_error = coalesce(job.last_error, 'Job lease expired after the maximum number of attempts.'),
        updated_at = now()
    where job.job_type = 'agent_run'
      and job.attempts >= job.max_attempts
      and (job.status = 'queued' or (job.status = 'running' and job.lease_expires_at <= now()))
    returning job.run_id
  loop
    update public.agent_runs
    set status = 'failed', finished_at = now(),
        error_code = 'worker_lease_exhausted',
        error_message = 'The run stopped responding and exhausted its retry attempts.'
    where id = v_exhausted.run_id and status not in ('completed', 'failed', 'cancelled');
    if found then
      perform private.append_agent_run_event(v_exhausted.run_id, 'run_failed',
        jsonb_build_object('error_code', 'worker_lease_exhausted', 'retrying', false));
    end if;
  end loop;

  return query
  with candidates as (
    select job.id
    from private.job_queue as job
    where job.job_type = 'agent_run'
      and job.attempts < job.max_attempts
      and ((job.status = 'queued' and job.available_at <= now())
        or (job.status = 'running' and job.lease_expires_at <= now()))
    order by job.priority desc, job.available_at, job.created_at
    for update skip locked
    limit v_limit
  )
  update private.job_queue as job
  set status = 'running', locked_at = now(), locked_by = btrim(p_worker_id),
      lease_expires_at = now() + interval '2 minutes', attempts = job.attempts + 1,
      last_error = null, updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

-- Renews the lease. Returns false when the worker no longer owns the job
-- (cancelled, reclaimed after lease expiry, or completed elsewhere).
create function private.heartbeat_agent_job(p_job_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.job_queue
  set lease_expires_at = now() + interval '2 minutes', updated_at = now()
  where id = p_job_id and job_type = 'agent_run' and status = 'running' and locked_by = p_worker_id;
  return found;
end;
$$;

-- Appends an event with the next per-run sequence. The run row lock serializes
-- concurrent writers so sequences stay unique and gap-free.
create function private.append_agent_run_event(p_run_id uuid, p_event_type text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_sequence bigint;
begin
  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;

  select coalesce(max(event.sequence), 0) + 1 into v_sequence
  from public.agent_run_events as event
  where event.run_id = p_run_id;

  insert into public.agent_run_events (organization_id, workspace_id, run_id, sequence, event_type, payload)
  values (v_run.organization_id, v_run.workspace_id, v_run.id, v_sequence, p_event_type, coalesce(p_payload, '{}'::jsonb));

  return v_sequence;
end;
$$;

create function public.cancel_agent_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.agent_runs%rowtype;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found or not exists (
    select 1 from public.organization_members as member
    where member.organization_id = v_run.organization_id
      and member.user_id = v_user_id
      and (member.role = 'admin' or (member.role = 'member' and v_run.created_by = v_user_id))
  ) then
    raise exception 'Run is not available for cancellation.' using errcode = '42501';
  end if;

  if v_run.status not in ('queued', 'planning', 'running', 'waiting_approval') then
    raise exception 'Run is no longer active.' using errcode = '22023';
  end if;

  update public.agent_runs
  set status = 'cancelled', finished_at = now(), error_code = null, error_message = null
  where id = p_run_id;

  update private.job_queue
  set status = 'cancelled', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now()
  where run_id = p_run_id and status in ('queued', 'running');

  update public.agent_run_steps
  set status = 'cancelled', finished_at = now()
  where run_id = p_run_id and status in ('queued', 'running', 'waiting_approval');

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, v_user_id, 'agent_run.cancelled', 'agent_run', v_run.id,
    jsonb_build_object('previous_status', v_run.status));

  perform private.append_agent_run_event(p_run_id, 'run_cancelled',
    jsonb_build_object('status', 'cancelled', 'cancelled_by', v_user_id));
end;
$$;

-- Users cancel runs only through cancel_agent_run(); direct status updates are removed
-- so a run can never be marked cancelled without its job and event stream following.
-- Supabase grants table-level privileges to API roles by default, so the table-level
-- UPDATE privilege is revoked as well as the column grant from the initial migration.
drop policy agent_runs_cancel_authorized on public.agent_runs;
revoke update on public.agent_runs from anon, authenticated;

revoke all on function private.heartbeat_agent_job(uuid, text) from public, anon, authenticated;
revoke all on function private.append_agent_run_event(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.claim_agent_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.cancel_agent_run(uuid) from public, anon;
grant execute on function private.heartbeat_agent_job(uuid, text) to service_role;
grant execute on function private.append_agent_run_event(uuid, text, jsonb) to service_role;
grant execute on function private.claim_agent_jobs(text, integer) to service_role;
grant execute on function public.cancel_agent_run(uuid) to authenticated;
