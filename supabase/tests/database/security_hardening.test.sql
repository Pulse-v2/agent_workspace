begin;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}', '{}', now(), now(), false, false
from (values
  ('e1000000-0000-0000-0000-00000000000a', 'sec-member-a@example.test'),
  ('e1000000-0000-0000-0000-00000000000b', 'sec-admin-b@example.test')
) as users(id, email);
insert into public.organizations (id, name, slug) values
  ('e2000000-0000-0000-0000-00000000000a', 'Sec A', 'sec-a'),
  ('e2000000-0000-0000-0000-00000000000b', 'Sec B', 'sec-b');
insert into public.organization_members (organization_id, user_id, role) values
  ('e2000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'member'),
  ('e2000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'admin');
insert into public.workspaces (id, organization_id, name, created_by) values
  ('e3000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', 'Sec WS A', 'e1000000-0000-0000-0000-00000000000a'),
  ('e3000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000b', 'Sec WS B', 'e1000000-0000-0000-0000-00000000000b');

select ok(not has_table_privilege('authenticated', 'public.documents', 'TRUNCATE'), 'authenticated cannot truncate tables (TRUNCATE bypasses RLS)');
select ok(not has_table_privilege('anon', 'public.agent_runs', 'TRUNCATE'), 'anon cannot truncate tables');
select ok(not has_table_privilege('authenticated', 'public.agent_runs', 'TRIGGER'), 'authenticated cannot create triggers');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- Storage path spoofing
select throws_ok($$
  insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum)
  values ('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'steal.txt', 'text/plain',
    'e2000000-0000-0000-0000-00000000000b/e3000000-0000-0000-0000-00000000000b/e4000000-0000-0000-0000-0000000000ff/secret.txt', 10, repeat('a', 64))
$$, '23514', null, 'a document cannot point at another organization''s file');
select throws_ok($$
  insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum)
  values ('e4000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'x.txt', 'text/plain',
    'e2000000-0000-0000-0000-00000000000a/e3000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000002/../../x.txt', 10, repeat('b', 64))
$$, '23514', null, 'document paths cannot traverse');

-- Worker-owned columns are normalized on client inserts
insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum, processing_status, embedding_status)
values ('e4000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'ok.txt', 'text/plain',
  'e2000000-0000-0000-0000-00000000000a/e3000000-0000-0000-0000-00000000000a/e4000000-0000-0000-0000-000000000003/ok.txt', 10, repeat('c', 64), 'indexed', 'completed');
select is((select processing_status from public.documents where id = 'e4000000-0000-0000-0000-000000000003'), 'queued', 'clients cannot mark documents indexed; processing is queued');
select is((select embedding_status from public.documents where id = 'e4000000-0000-0000-0000-000000000003'), 'pending', 'clients cannot set embedding status');

insert into public.agent_runs (id, organization_id, workspace_id, created_by, title, objective, model, input_tokens, estimated_cost_usd, retry_count, error_code)
values ('e5000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'Spoof', 'Try to spoof usage', 'gpt-x', 999999, 42, 7, 'fake');
select is((select input_tokens from public.agent_runs where id = 'e5000000-0000-0000-0000-000000000001'), 0, 'clients cannot set token usage');
select is((select estimated_cost_usd from public.agent_runs where id = 'e5000000-0000-0000-0000-000000000001'), 0::numeric, 'clients cannot set cost');
select is((select coalesce(model, '-') || ':' || retry_count || ':' || coalesce(error_code, '-') from public.agent_runs where id = 'e5000000-0000-0000-0000-000000000001'), '-:0:-', 'clients cannot set model, retries, or errors');

-- INSERT ... RETURNING works with the inline visibility policy
select lives_ok($$
  insert into public.agent_runs (organization_id, workspace_id, created_by, title, objective)
  values ('e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'Returning', 'Insert returning works') returning id
$$, 'run creators can insert with RETURNING');
select is((select count(*)::integer from public.agent_runs), 2, 'member sees their own runs');

select set_config('request.jwt.claims', '{"sub":"e1000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::integer from public.agent_runs), 0, 'other organizations see none of these runs');
select throws_ok($$
  insert into public.agent_runs (organization_id, workspace_id, created_by, title, objective)
  values ('e2000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', auth.uid(), 'Intrude', 'Run in another org')
$$, '42501', null, 'cannot create runs in another organization');

select * from finish();
rollback;
