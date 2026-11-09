-- Phase 5: tool registry support and human-in-the-loop approvals.
--
-- Approval lifecycle of an approval-required tool step:
--   waiting_approval --(decide: approve)--> approved --(worker executes)--> running --> completed | failed
--   waiting_approval --(decide: reject)---> rejected   (the rejection is returned to the agent)
-- Decisions are only possible through decide_agent_run_approval(), which checks
-- authorization, prevents double decisions with row locks and status guards,
-- writes the audit log, emits the event, and re-queues the run for the worker.

-- A decided step keeps its approver while the worker executes it.
alter table public.agent_run_steps drop constraint agent_run_steps_check;
alter table public.agent_run_steps add constraint agent_run_steps_approval_check check (
  (approved_by is null and approved_at is null)
  or (
    approved_by is not null and approved_at is not null and requires_approval
    and status in ('approved', 'rejected', 'running', 'completed', 'failed', 'cancelled')
  )
);

create index agent_run_steps_pending_approval_idx
  on public.agent_run_steps (organization_id, created_at desc)
  where status = 'waiting_approval';

-- Links an artifact to the approved step that created it. The unique constraint
-- makes save_report idempotent if a worker crashes between insert and step completion.
alter table public.artifacts
  add column source_step_id uuid references public.agent_run_steps(id) on delete set null;
create unique index artifacts_source_step_uidx on public.artifacts (source_step_id) where source_step_id is not null;
create index artifacts_run_idx on public.artifacts (run_id) where run_id is not null;

create function public.decide_agent_run_approval(
  p_run_id uuid,
  p_step_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_run public.agent_runs%rowtype;
  v_step public.agent_run_steps%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Reason must be at most 1000 characters.' using errcode = '22023';
  end if;

  -- Lock order (run, then step) matches the worker to avoid deadlocks.
  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found or not exists (
    select 1 from public.organization_members as member
    where member.organization_id = v_run.organization_id
      and member.user_id = v_user_id
      and (member.role = 'admin' or (member.role = 'member' and v_run.created_by = v_user_id))
  ) then
    -- Same error for "missing" and "not allowed" so run IDs cannot be probed.
    raise exception 'Approval is not available.' using errcode = '42501';
  end if;

  select * into v_step from public.agent_run_steps where id = p_step_id and run_id = p_run_id for update;
  if not found or not v_step.requires_approval then
    raise exception 'Approval is not available.' using errcode = '42501';
  end if;
  if v_step.status <> 'waiting_approval' or v_run.status <> 'waiting_approval' then
    raise exception 'This action has already been decided or is no longer pending.' using errcode = '55000';
  end if;

  update public.agent_run_steps
  set status = p_decision, approved_by = v_user_id, approved_at = now(),
      output_json = coalesce(output_json, '{}'::jsonb) || jsonb_build_object('decision', jsonb_build_object(
        'decision', p_decision, 'decided_by', v_user_id, 'decided_at', now(), 'reason', v_reason))
  where id = p_step_id;

  update public.agent_runs set status = 'queued' where id = p_run_id;

  -- Re-queue the run's single job with a fresh retry budget for the resumed phase.
  update private.job_queue
  set status = 'queued', attempts = 0, available_at = now(), last_error = null,
      locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now()
  where run_id = p_run_id and job_type = 'agent_run';

  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  values (v_run.organization_id, v_user_id,
    case p_decision when 'approved' then 'agent_run.approval_approved' else 'agent_run.approval_rejected' end,
    'agent_run_step', p_step_id,
    jsonb_build_object('run_id', p_run_id, 'tool_name', v_step.tool_name, 'reason', v_reason));

  perform private.append_agent_run_event(p_run_id,
    case p_decision when 'approved' then 'approval_approved' else 'approval_rejected' end,
    jsonb_build_object('step_id', p_step_id, 'tool_name', v_step.tool_name, 'decided_by', v_user_id, 'reason', v_reason));
end;
$$;

-- Decisions go through the function only: remove direct step updates by API roles.
drop policy agent_run_steps_approval_decision on public.agent_run_steps;
revoke update on public.agent_run_steps from anon, authenticated;

-- Artifacts created by agents are written by the worker; users keep their existing
-- artifact policies but cannot forge or alter the agent provenance link. (A column
-- revoke would be ineffective because API roles hold table-level privileges.)
create function private.guard_artifact_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.source_step_id is not null)
      or (tg_op = 'UPDATE' and new.source_step_id is distinct from old.source_step_id) then
      raise exception 'Artifact provenance is managed by the agent worker.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger artifacts_guard_provenance
before insert or update on public.artifacts
for each row execute function private.guard_artifact_provenance();

revoke all on function private.guard_artifact_provenance() from public, anon, authenticated;

revoke all on function public.decide_agent_run_approval(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_agent_run_approval(uuid, uuid, text, text) to authenticated;
