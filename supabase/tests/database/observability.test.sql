begin;
select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('d1000000-0000-0000-0000-00000000000a', 'obs-admin@example.test'),
  ('d1000000-0000-0000-0000-00000000000b', 'obs-member@example.test'),
  ('d1000000-0000-0000-0000-00000000000c', 'obs-outsider@example.test')
) as users(id, email);
insert into public.organizations (id, name, slug) values
  ('d2000000-0000-0000-0000-000000000001', 'Obs Org', 'obs-org'),
  ('d2000000-0000-0000-0000-000000000002', 'Obs Outsider', 'obs-outsider');
insert into public.organization_members (organization_id, user_id, role) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'admin'),
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b', 'member'),
  ('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-00000000000c', 'admin');
insert into public.workspaces (id, organization_id, name, created_by)
values ('d3000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'Obs WS', 'd1000000-0000-0000-0000-00000000000a');
insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective, status, model, input_tokens, output_tokens, estimated_cost_usd, started_at, finished_at, error_code) values
  ('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000a', 'Admin run', 'Objective one', 'completed', 'gpt-test', 1000, 200, 0.5, now() - interval '10 seconds', now(), null),
  ('d4000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-00000000000b', 'Member run', 'Objective two', 'failed', 'gpt-test', 100, 10, 0.05, now() - interval '5 seconds', now(), 'tool_failed');
insert into public.agent_run_steps (organization_id, workspace_id, run_id, step_index, step_type, title, status, tool_name, started_at, finished_at) values
  ('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 0, 'retrieval', 'Search', 'completed', 'search_documents', now() - interval '2 seconds', now()),
  ('d2000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002', 0, 'tool', 'Calc', 'failed', 'calculate', now(), now());
insert into private.worker_heartbeats (worker_id, status, last_seen_at) values ('obs-worker', 'running', now());

select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'agent_run_events'), 'run events are published to realtime');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'documents'), 'document status changes are published to realtime');
select ok(not has_table_privilege('authenticated', 'private.worker_heartbeats', 'SELECT'), 'users cannot read worker heartbeats directly');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{totals,runs}')::integer, 2, 'admin usage includes all organization runs');
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{totals,input_tokens}')::integer, 1100, 'token totals are summed');
select is(jsonb_array_length(public.usage_summary('d2000000-0000-0000-0000-000000000001', 7) -> 'daily'), 7, 'daily series covers the requested window');
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{failures,0,error_code}'), 'tool_failed', 'failures are grouped by error code');
select is((public.queue_status('d2000000-0000-0000-0000-000000000001') ->> 'workers_online')::integer, 1, 'members see worker liveness');

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{totals,runs}')::integer, 1, 'member usage only includes runs visible to them (RLS)');
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{tools,0,tool_name}'), 'calculate', 'tool statistics respect run visibility');

select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((public.usage_summary('d2000000-0000-0000-0000-000000000001', 30) #>> '{totals,runs}')::integer, 0, 'other organizations see no usage');
select throws_ok($$select public.queue_status('d2000000-0000-0000-0000-000000000001')$$, '42501', null, 'other organizations cannot read the queue status');

select * from finish();
rollback;
