begin;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retrieval@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false);
insert into public.organizations (id, name, slug) values ('92000000-0000-0000-0000-000000000001', 'Retrieval Organization', 'retrieval-org');
insert into public.organization_members (organization_id, user_id, role) values ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'viewer');
insert into public.workspaces (id, organization_id, name, created_by) values ('93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'Research', '91000000-0000-0000-0000-000000000001');
insert into public.documents (id, organization_id, workspace_id, uploaded_by, file_name, mime_type, storage_path, size_bytes, checksum, processing_status, embedding_status)
values ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'alpha.pdf', 'application/pdf', '92000000-0000-0000-0000-000000000001/93000000-0000-0000-0000-000000000001/94000000-0000-0000-0000-000000000001/alpha.pdf', 128, repeat('a', 64), 'indexed', 'completed');
insert into public.document_chunks (id, organization_id, workspace_id, document_id, chunk_index, content, embedding, metadata)
values
  ('95000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 0, 'The launch date is April 15.', ('[' || '1,' || array_to_string(array_fill(0::real, array[1535]), ',') || ']')::extensions.vector, '{"page":4}'),
  ('95000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 1, 'The budget is 20 million dollars.', ('[' || '0,' || '1,' || array_to_string(array_fill(0::real, array[1534]), ',') || ']')::extensions.vector, '{"page":9}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select file_name from public.match_document_chunks('92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', ('[' || '1,' || array_to_string(array_fill(0::real, array[1535]), ',') || ']')::extensions.vector, 0.8, 5) limit 1), 'alpha.pdf', 'similarity search returns authorized source metadata');
select is((select count(*)::integer from public.match_document_chunks('92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', ('[' || '1,' || array_to_string(array_fill(0::real, array[1535]), ',') || ']')::extensions.vector, 0.8, 5)), 1, 'similarity threshold filters less relevant chunks');
select is((select metadata->>'page' from public.match_document_chunks('92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', ('[' || '1,' || array_to_string(array_fill(0::real, array[1535]), ',') || ']')::extensions.vector, 0.8, 5) limit 1), '4', 'retrieval preserves page metadata');
select is((select count(*)::integer from public.match_document_chunks('92000000-0000-0000-0000-000000000099', '93000000-0000-0000-0000-000000000001', ('[' || '1,' || array_to_string(array_fill(0::real, array[1535]), ',') || ']')::extensions.vector, -1, 5)), 0, 'unauthorized organization/workspace returns no chunks');

select * from finish();
rollback;
