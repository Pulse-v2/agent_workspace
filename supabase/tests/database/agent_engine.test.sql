begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
  ('81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'engine@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('81000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false);
insert into public.organizations (id, name, slug) values
  ('82000000-0000-0000-0000-000000000001', 'Engine Organization', 'engine-org'),
  ('82000000-0000-0000-0000-000000000002', 'Outsider Organization', 'outsider-org');
insert into public.organization_members (organization_id, user_id, role) values
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'admin'),
  ('82000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000002', 'admin');
insert into public.workspaces (id, organization_id, name, created_by) values ('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'Engine Workspace', '81000000-0000-0000-0000-000000000001');
insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum)
values ('84000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'notes.txt', 'text/plain', '82000000-0000-0000-0000-000000000001/83000000-0000-0000-0000-000000000001/84000000-0000-0000-0000-000000000001/notes.txt', 80, repeat('d', 64));
insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective) values
  ('85000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Review notes', 'Summarize the notes.'),
  ('85000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Crashed run', 'Summarize the notes again.');

select is((select processing_status from public.documents where id = '84000000-0000-0000-0000-000000000001'), 'queued', 'document insert queues document processing');
select is((select event_type from public.agent_run_events where run_id = '85000000-0000-0000-0000-000000000001' and sequence = 1), 'run_created', 'new agent run starts its event stream with run_created');

-- Sequencing
select is(private.append_agent_run_event('85000000-0000-0000-0000-000000000001', 'run_started', '{}'), 2::bigint, 'events receive the next per-run sequence');
select is(private.append_agent_run_event('85000000-0000-0000-0000-000000000002', 'run_started', '{}'), 2::bigint, 'sequences are independent per run');

-- Claiming and leases
select is((select count(*)::integer from private.claim_agent_jobs('engine-worker-a', 1)), 1, 'agent worker claims one job when asked for one');
select is((select count(*)::integer from private.claim_agent_jobs('engine-worker-b', 5)), 1, 'a second worker claims only the remaining agent job');
select is((select count(*)::integer from private.claim_agent_jobs('engine-worker-c', 5)), 0, 'leased jobs are not claimed again');
select is((select status from private.job_queue where document_id = '84000000-0000-0000-0000-000000000001'), 'queued', 'agent claim leaves document jobs untouched');
select ok(private.heartbeat_agent_job((select id from private.job_queue where locked_by = 'engine-worker-a'), 'engine-worker-a'), 'lease owner can renew its lease');
select ok(not private.heartbeat_agent_job((select id from private.job_queue where locked_by = 'engine-worker-a'), 'engine-worker-b'), 'another worker cannot renew a lease it does not own');

-- Crash recovery: an expired lease can be reclaimed while attempts remain.
update private.job_queue set lease_expires_at = now() - interval '1 second' where run_id = '85000000-0000-0000-0000-000000000002';
select is((select locked_by from private.claim_agent_jobs('engine-worker-c', 5)), 'engine-worker-c', 'an expired lease is reclaimed by another worker');
select is((select attempts from private.job_queue where run_id = '85000000-0000-0000-0000-000000000002'), 2, 'reclaiming counts as a new attempt');

-- Crash on the final attempt fails the run permanently.
update private.job_queue set lease_expires_at = now() - interval '1 second', attempts = max_attempts where run_id = '85000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from private.claim_agent_jobs('engine-worker-c', 5)), 0, 'exhausted jobs are not claimed');
select is((select status from public.agent_runs where id = '85000000-0000-0000-0000-000000000002'), 'failed', 'exhausted lease fails the run');

-- Cancellation
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.cancel_agent_run('85000000-0000-0000-0000-000000000001')$$, '42501', null, 'admins of another organization cannot cancel the run');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.cancel_agent_run('85000000-0000-0000-0000-000000000001');
reset role;
select is((select status from private.job_queue where run_id = '85000000-0000-0000-0000-000000000001'), 'cancelled', 'cancellation releases the job lease');
select is((select event_type from public.agent_run_events where run_id = '85000000-0000-0000-0000-000000000001' order by sequence desc limit 1), 'run_cancelled', 'cancellation is persisted as the next ordered event');

select * from finish();
rollback;
