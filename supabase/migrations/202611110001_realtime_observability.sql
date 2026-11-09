-- Phase 7: realtime updates, usage statistics, and worker observability.

-- 1. Realtime -----------------------------------------------------------------
-- Postgres Changes are delivered per subscriber only if the subscriber's RLS
-- SELECT policy allows the row (agent_run_events: can_read_agent_run;
-- documents: organization membership), so no tenant can observe another.
alter publication supabase_realtime add table public.agent_run_events, public.documents;

-- 2. Usage statistics ------------------------------------------------------------
-- SECURITY INVOKER: aggregates only over rows the caller can already read via RLS.
create function public.usage_summary(p_organization_id uuid, p_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as days
  ),
  runs as (
    select run.*
    from public.agent_runs as run, params
    where run.organization_id = p_organization_id
      and run.created_at >= (current_date - (params.days - 1))
  ),
  tool_steps as (
    select step.tool_name, step.status, step.started_at, step.finished_at
    from public.agent_run_steps as step
    join runs on runs.id = step.run_id
    where step.tool_name is not null
  )
  select jsonb_build_object(
    'days', (select days from params),
    'totals', (
      select jsonb_build_object(
        'runs', count(*),
        'completed', count(*) filter (where status = 'completed'),
        'failed', count(*) filter (where status = 'failed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'active', count(*) filter (where status in ('queued', 'planning', 'running', 'waiting_approval')),
        'demo_runs', count(*) filter (where model = 'demo-deterministic'),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0),
        'estimated_cost_usd', coalesce(sum(estimated_cost_usd), 0),
        'retries', coalesce(sum(retry_count), 0),
        'avg_duration_seconds', round(avg(extract(epoch from finished_at - started_at)) filter (where finished_at is not null and started_at is not null)::numeric, 1)
      )
      from runs
    ),
    'daily', (
      select coalesce(jsonb_agg(day_row order by day_row.day), '[]'::jsonb)
      from (
        select day::date as day,
          count(runs.id) as runs,
          coalesce(sum(runs.input_tokens), 0) as input_tokens,
          coalesce(sum(runs.output_tokens), 0) as output_tokens,
          coalesce(sum(runs.estimated_cost_usd), 0) as estimated_cost_usd
        from params, generate_series(current_date - (params.days - 1), current_date, interval '1 day') as day
        left join runs on runs.created_at::date = day::date
        group by day
      ) as day_row
    ),
    'by_model', (
      select coalesce(jsonb_agg(model_row order by model_row.runs desc), '[]'::jsonb)
      from (
        select coalesce(model, 'not started') as model, count(*) as runs,
          coalesce(sum(input_tokens + output_tokens), 0) as tokens,
          coalesce(sum(estimated_cost_usd), 0) as estimated_cost_usd
        from runs group by coalesce(model, 'not started')
      ) as model_row
    ),
    'by_workspace', (
      select coalesce(jsonb_agg(workspace_row order by workspace_row.runs desc), '[]'::jsonb)
      from (
        select workspace_id, count(*) as runs,
          coalesce(sum(input_tokens + output_tokens), 0) as tokens,
          coalesce(sum(estimated_cost_usd), 0) as estimated_cost_usd
        from runs group by workspace_id
      ) as workspace_row
    ),
    'tools', (
      select coalesce(jsonb_agg(tool_row order by tool_row.calls desc), '[]'::jsonb)
      from (
        select tool_name, count(*) as calls,
          count(*) filter (where status = 'failed') as failed,
          count(*) filter (where status = 'rejected') as rejected,
          round(avg(extract(epoch from finished_at - started_at) * 1000) filter (where finished_at is not null and started_at is not null)::numeric) as avg_duration_ms
        from tool_steps group by tool_name
      ) as tool_row
    ),
    'failures', (
      select coalesce(jsonb_agg(failure_row order by failure_row.runs desc), '[]'::jsonb)
      from (
        select coalesce(error_code, 'unknown') as error_code, count(*) as runs
        from runs where status = 'failed' group by coalesce(error_code, 'unknown')
      ) as failure_row
    ),
    'top_runs', (
      select coalesce(jsonb_agg(top_row), '[]'::jsonb)
      from (
        select id, title, status, model, input_tokens + output_tokens as tokens, estimated_cost_usd, created_at
        from runs order by estimated_cost_usd desc, input_tokens + output_tokens desc limit 5
      ) as top_row
    )
  );
$$;

revoke all on function public.usage_summary(uuid, integer) from public, anon;
grant execute on function public.usage_summary(uuid, integer) to authenticated;

-- 3. Worker observability --------------------------------------------------------
create table private.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 120),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null check (status in ('running', 'stopping')),
  active_jobs integer not null default 0 check (active_jobs >= 0),
  processed_jobs bigint not null default 0 check (processed_jobs >= 0),
  failed_jobs bigint not null default 0 check (failed_jobs >= 0),
  version text
);
alter table private.worker_heartbeats enable row level security;
grant select, insert, update, delete on private.worker_heartbeats to service_role;

-- Organization-scoped queue view plus anonymous worker liveness (no host names or IDs).
create function public.queue_status(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_organization_id, array['admin', 'member', 'viewer']) then
    raise exception 'Queue status is not available.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'agent_runs_queued', (select count(*) from private.job_queue where organization_id = p_organization_id and job_type = 'agent_run' and status = 'queued'),
    'agent_runs_running', (select count(*) from private.job_queue where organization_id = p_organization_id and job_type = 'agent_run' and status = 'running'),
    'documents_queued', (select count(*) from private.job_queue where organization_id = p_organization_id and job_type = 'document_process' and status = 'queued'),
    'documents_running', (select count(*) from private.job_queue where organization_id = p_organization_id and job_type = 'document_process' and status = 'running'),
    'oldest_queued_seconds', (
      select round(extract(epoch from now() - min(available_at)))
      from private.job_queue
      where organization_id = p_organization_id and status = 'queued' and available_at <= now()
    ),
    'workers_online', (select count(*) from private.worker_heartbeats where last_seen_at > now() - interval '60 seconds' and status = 'running'),
    'last_worker_heartbeat_at', (select max(last_seen_at) from private.worker_heartbeats)
  );
end;
$$;

revoke all on function public.queue_status(uuid) from public, anon;
grant execute on function public.queue_status(uuid) to authenticated;
