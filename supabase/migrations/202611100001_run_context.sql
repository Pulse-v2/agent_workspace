-- Phase 6: task context chosen when creating a run.
--
-- context.document_ids optionally restricts which workspace documents the agent
-- may search or analyze. The API validates that every ID belongs to the run's
-- workspace; the worker enforces the scope when tools execute.
alter table public.agent_runs
  add column context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 16384);
