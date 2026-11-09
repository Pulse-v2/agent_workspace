begin;
select plan(41);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new-user@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'invited-user@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false);

insert into public.organizations (id, name, slug)
values
  ('20000000-0000-0000-0000-000000000001', 'Organization Alpha', 'organization-alpha'),
  ('20000000-0000-0000-0000-000000000002', 'Organization Beta', 'organization-beta');

insert into public.organization_members (organization_id, user_id, role)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'viewer'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'admin');

insert into public.workspaces (id, organization_id, name, created_by)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Alpha Research', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Beta Research', '10000000-0000-0000-0000-000000000004');

insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum, processing_status)
values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'alpha.txt', 'text/plain', '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/alpha.txt', 128, repeat('a', 64), 'indexed'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'beta.txt', 'text/plain', '20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000002/beta.txt', 128, repeat('b', 64), 'indexed');

insert into public.document_chunks (organization_id, workspace_id, document_id, chunk_index, content, metadata)
values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 0, 'Alpha source content.', '{"page":1}'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 0, 'Beta source content.', '{"page":1}');

insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective, status)
values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Completed alpha run', 'Review Alpha source', 'completed'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Member alpha run', 'Review Alpha source', 'waiting_approval'),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'Completed beta run', 'Review Beta source', 'completed');

insert into public.agent_run_steps (id, organization_id, workspace_id, run_id, step_index, step_type, title, status, requires_approval)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 0, 'final', 'Alpha result', 'completed', false),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 0, 'tool', 'Save Alpha report', 'waiting_approval', true),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 0, 'final', 'Beta result', 'completed', false);

insert into public.agent_run_events (organization_id, workspace_id, run_id, sequence, event_type)
values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 1, 'run.completed'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 1, 'run.completed');

insert into public.artifacts (organization_id, workspace_id, run_id, created_by, title, artifact_type, content_markdown)
values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Alpha report', 'report', '# Alpha'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'Beta report', 'report', '# Beta');

insert into storage.objects (bucket_id, name, owner_id)
values
  ('workspace-documents', '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/alpha.txt', '10000000-0000-0000-0000-000000000001'),
  ('workspace-documents', '20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000002/beta.txt', '10000000-0000-0000-0000-000000000004');

insert into private.job_queue (organization_id, workspace_id, run_id, job_type, dedupe_key, priority)
values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'agent_run', 'test-alpha-run', 2),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 'agent_run', 'test-beta-run', 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is((select count(*)::integer from public.organizations), 1, 'viewer only sees their organization');
select is((select count(*)::integer from public.organization_members), 1, 'viewer sees only their own membership row');
select is((select count(*)::integer from public.workspaces), 1, 'viewer only sees workspaces in their organization');
select is((select count(*)::integer from public.documents), 1, 'viewer cannot read another organization documents');
select is((select count(*)::integer from public.document_chunks), 1, 'viewer cannot read another organization chunks');
select is((select count(*)::integer from public.agent_runs), 1, 'viewer sees completed runs only');
select is((select count(*)::integer from public.agent_run_steps), 1, 'viewer only sees steps for readable runs');
select is((select count(*)::integer from public.agent_run_events), 1, 'viewer only sees events for readable runs');
select is((select count(*)::integer from public.artifacts), 1, 'viewer only sees artifacts in their organization');
select is((select count(*)::integer from storage.objects where bucket_id = 'workspace-documents'), 1, 'viewer only sees storage objects in their organization');
select throws_ok($$select public.cancel_agent_run('50000000-0000-0000-0000-000000000002')$$, '42501', null, 'viewer cannot cancel runs through the cancellation function');
select throws_ok($$update public.agent_runs set status = 'cancelled' where id = '50000000-0000-0000-0000-000000000002'$$, '42501', null, 'run status cannot be updated directly');
select throws_ok($$select public.decide_agent_run_approval('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'approved')$$, '42501', null, 'viewer cannot approve through the decision function');
select throws_ok($$update public.agent_run_steps set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = '60000000-0000-0000-0000-000000000002'$$, '42501', null, 'steps cannot be approved by direct update');
select throws_ok($$insert into public.workspaces (organization_id, name, created_by) values ('20000000-0000-0000-0000-000000000001', 'Forbidden workspace', auth.uid())$$, '42501', null, 'viewer cannot create workspaces');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('workspace-documents', '20000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002/new-file.txt', auth.uid())$$, '42501', null, 'viewer cannot upload to another organization');
select throws_ok($$insert into public.organization_members (organization_id, user_id, role) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'member')$$, '42501', null, 'viewer cannot manage organization membership');

reset role;
select is((select status from public.agent_runs where id = '50000000-0000-0000-0000-000000000002'), 'waiting_approval', 'viewer cannot cancel a member run');
select is((select status from public.agent_run_steps where id = '60000000-0000-0000-0000-000000000002'), 'waiting_approval', 'viewer cannot approve a tool action');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.agent_runs), 2, 'admin can see every run in their organization');
select is((select count(*)::integer from public.organization_members), 3, 'admin can see all organization membership rows');
insert into public.organization_members (organization_id, user_id, role)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'member');
select is((select role from public.organization_members where user_id = '10000000-0000-0000-0000-000000000006'), 'member', 'admin can grant a role to an organization member');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.agent_runs), 1, 'member sees their own run and not other runs');
select lives_ok($$select public.decide_agent_run_approval('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'approved')$$, 'run creator (member) can approve their own run');
select is((select status from public.agent_run_steps where id = '60000000-0000-0000-0000-000000000002'), 'approved', 'member decision is persisted');
select lives_ok($$select public.cancel_agent_run('50000000-0000-0000-0000-000000000002')$$, 'member can call cancellation for their own run');
select is((select status from public.agent_runs where id = '50000000-0000-0000-0000-000000000002'), 'cancelled', 'member may cancel their own active run');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.organizations), 1, 'second organization admin sees only their organization');
select is((select count(*)::integer from public.documents), 1, 'second organization admin sees only their documents');
select is((select count(*)::integer from public.agent_runs), 1, 'second organization admin sees only their runs');
select is((select count(*)::integer from public.artifacts), 1, 'second organization admin sees only their artifacts');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('workspace-documents', '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000001/mismatched.txt', auth.uid())$$, '42501', null, 'storage paths cannot pair an organization with another organization workspace');

reset role;
select ok(not has_function_privilege('authenticated', 'private.claim_agent_jobs(text,integer)', 'EXECUTE'), 'authenticated users cannot claim worker jobs');
set local role service_role;
select is((select count(*)::integer from private.claim_agent_jobs('worker-a', 1)), 1, 'worker atomically claims one available job');
select is((select attempts from private.job_queue where locked_by = 'worker-a'), 1, 'job attempt count increments on claim');
select is((select count(*)::integer from private.claim_agent_jobs('worker-b', 1)), 1, 'second worker claims the next job');
select is((select count(*)::integer from private.job_queue where status = 'queued'), 0, 'claimed jobs are no longer available to other workers');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is((select count(*)::integer from public.create_organization_with_workspace('Gamma Analytics', 'gamma-analytics', 'First Workspace')), 1, 'onboarding creates organization and workspace atomically');
select is((select role from public.organization_members where organization_id = (select id from public.organizations where slug = 'gamma-analytics') and user_id = auth.uid()), 'admin', 'organization creator is assigned admin role');
select is((select count(*)::integer from public.workspaces where organization_id = (select id from public.organizations where slug = 'gamma-analytics')), 1, 'onboarding creates the first workspace');
select is((select count(*)::integer from public.audit_logs where organization_id = (select id from public.organizations where slug = 'gamma-analytics') and action = 'organization.created'), 1, 'onboarding writes an audit event');

select * from finish();
rollback;
