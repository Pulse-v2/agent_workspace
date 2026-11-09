begin;
select plan(20);

-- Users: admin (A), run creator member (M), other member (O), viewer (V), outsider admin (X).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('c1000000-0000-0000-0000-00000000000a', 'approvals-admin@example.test'),
  ('c1000000-0000-0000-0000-00000000000b', 'approvals-member@example.test'),
  ('c1000000-0000-0000-0000-00000000000c', 'approvals-other@example.test'),
  ('c1000000-0000-0000-0000-00000000000d', 'approvals-viewer@example.test'),
  ('c1000000-0000-0000-0000-00000000000e', 'approvals-outsider@example.test')
) as users(id, email);

insert into public.organizations (id, name, slug) values
  ('c2000000-0000-0000-0000-000000000001', 'Approvals Org', 'approvals-org'),
  ('c2000000-0000-0000-0000-000000000002', 'Outsider Org', 'approvals-outsider-org');
insert into public.organization_members (organization_id, user_id, role) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000a', 'admin'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'member'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000c', 'member'),
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000d', 'viewer'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-00000000000e', 'admin');
insert into public.workspaces (id, organization_id, name, created_by)
values ('c3000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'Approvals WS', 'c1000000-0000-0000-0000-00000000000a');

-- Two runs created by the member; the trigger enqueues their jobs.
insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective) values
  ('c4000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'Approve me', 'Save a report.'),
  ('c4000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-00000000000b', 'Reject me', 'Save a report.');

-- Simulate the worker pausing both runs for approval.
update public.agent_runs set status = 'waiting_approval' where id in ('c4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002');
update private.job_queue set status = 'completed', attempts = 2 where run_id in ('c4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002');
insert into public.agent_run_steps (id, organization_id, workspace_id, run_id, step_index, step_type, title, status, tool_name, requires_approval, input_json, output_json) values
  ('c5000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 0, 'tool', 'Save report', 'waiting_approval', 'save_report', true, '{"title":"Q3"}', '{"approval":{"title":"Q3"}}'),
  ('c5000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', 0, 'tool', 'Save report', 'waiting_approval', 'save_report', true, '{"title":"Q3"}', '{"approval":{"title":"Q3"}}'),
  ('c5000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', 1, 'tool', 'Search', 'completed', 'search_documents', false, '{}', '{}');

set local role authenticated;

-- Authorization
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'approved')$$, '42501', null, 'viewers cannot approve');
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'approved')$$, '42501', null, 'members cannot approve runs they did not create');
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'approved')$$, '42501', null, 'admins of other organizations cannot approve');

-- Input validation
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'maybe')$$, '22023', null, 'decision must be approved or rejected');
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000003', 'approved')$$, '42501', null, 'a step from another run cannot be approved through this run');
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000003', 'approved')$$, '42501', null, 'steps that do not require approval cannot be approved');

-- Approve (run creator)
select lives_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'approved')$$, 'run creator approves the pending action');
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'approved')$$, '55000', null, 'an approval cannot be applied twice');
select throws_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'rejected')$$, '55000', null, 'a decided action cannot be reversed');

-- Reject (admin) with reason
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok($$select public.decide_agent_run_approval('c4000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002', 'rejected', 'Numbers are not final.')$$, 'admin rejects with a reason');

-- Artifact provenance cannot be forged by users.
select throws_ok($$insert into public.artifacts (organization_id, workspace_id, created_by, title, artifact_type, content_markdown, source_step_id) values ('c2000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', auth.uid(), 'Forged', 'report', '# x', 'c5000000-0000-0000-0000-000000000001')$$, '42501', null, 'users cannot attach artifacts to agent steps');

reset role;

select is((select status from public.agent_run_steps where id = 'c5000000-0000-0000-0000-000000000001'), 'approved', 'approved step status is persisted');
select is((select approved_by from public.agent_run_steps where id = 'c5000000-0000-0000-0000-000000000001'), 'c1000000-0000-0000-0000-00000000000b'::uuid, 'approver is recorded');
select is((select status from public.agent_runs where id = 'c4000000-0000-0000-0000-000000000001'), 'queued', 'approval re-queues the run');
select is((select status || ':' || attempts from private.job_queue where run_id = 'c4000000-0000-0000-0000-000000000001'), 'queued:0', 'approval re-queues the job with a fresh retry budget');
select is((select event_type from public.agent_run_events where run_id = 'c4000000-0000-0000-0000-000000000001' order by sequence desc limit 1), 'approval_approved', 'approval emits approval_approved');
select is((select output_json #>> '{decision,reason}' from public.agent_run_steps where id = 'c5000000-0000-0000-0000-000000000002'), 'Numbers are not final.', 'rejection reason is stored with the decision');
select is((select event_type from public.agent_run_events where run_id = 'c4000000-0000-0000-0000-000000000002' order by sequence desc limit 1), 'approval_rejected', 'rejection emits approval_rejected');
select is((select count(*)::integer from public.audit_logs where entity_id in ('c5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000002') and action in ('agent_run.approval_approved', 'agent_run.approval_rejected')), 2, 'both decisions are audit logged');
select ok(exists(select 1 from pg_constraint where conname = 'agent_run_steps_approval_check'), 'approval constraint exists');

select * from finish();
rollback;
