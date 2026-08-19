begin;

select plan(19);

select ok(has_table_privilege('tracker_api_owner','public.migration_receipts','SELECT'),'tracker_api_owner retains receipt select');
select ok(has_table_privilege('tracker_api_owner','public.migration_receipts','INSERT'),'tracker_api_owner can insert receipts');
select ok(has_table_privilege('tracker_api_owner','public.migration_receipts','UPDATE'),'tracker_api_owner can update receipts');
select ok(not has_table_privilege('tracker_api_owner','public.migration_receipts','DELETE'),'tracker_api_owner cannot delete receipts');
select ok(not has_table_privilege('authenticated','public.migration_receipts','INSERT,UPDATE,DELETE'),'authenticated cannot mutate receipts directly');
select ok(not has_table_privilege('anon','public.migration_receipts','SELECT,INSERT,UPDATE,DELETE'),'anon has no receipt privilege');
select ok(not has_table_privilege('public','public.migration_receipts','SELECT,INSERT,UPDATE,DELETE'),'PUBLIC has no receipt privilege');

select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='public' and tablename='migration_receipts' and cmd='INSERT'),1,'one controlled receipt insert policy exists');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='public' and tablename='migration_receipts' and cmd='UPDATE'),1,'one controlled receipt update policy exists');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname='public' and tablename='migration_receipts' and cmd in ('DELETE','ALL')),0,'no receipt delete policy exists');
select is((select roles::text from pg_catalog.pg_policies where schemaname='public' and tablename='migration_receipts' and cmd='INSERT'),'{tracker_api_owner}','insert policy targets only tracker_api_owner');
select is((select roles::text from pg_catalog.pg_policies where schemaname='public' and tablename='migration_receipts' and cmd='UPDATE'),'{tracker_api_owner}','update policy targets only tracker_api_owner');

insert into auth.users(id,email) values
  ('a1000000-0000-0000-0000-000000000001','receipt-a@example.invalid'),
  ('b2000000-0000-0000-0000-000000000002','receipt-b@example.invalid');
grant tracker_api_owner to postgres;
select pg_catalog.set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
set local role tracker_api_owner;
insert into public.migration_receipts(user_id,migration_key,source_schema_version,source_checksum,result_checksum)
values('a1000000-0000-0000-0000-000000000001','own',1,repeat('a',64),repeat('a',64));
update public.migration_receipts set result_checksum=repeat('c',64) where migration_key='own';
reset role;

select is((select count(*) from public.migration_receipts where user_id='a1000000-0000-0000-0000-000000000001'),1::bigint,'controlled role inserts an owner receipt');
select is((select result_checksum from public.migration_receipts where migration_key='own'),repeat('c',64),'controlled role updates an owner receipt');

select throws_ok(
  $$set local role tracker_api_owner; insert into public.migration_receipts(user_id,migration_key,source_schema_version,source_checksum,result_checksum) values('b2000000-0000-0000-0000-000000000002','cross-owner',1,repeat('b',64),repeat('b',64))$$,
  '42501',
  'new row violates row-level security policy for table "migration_receipts"',
  'controlled role cannot insert another owner receipt'
);
reset role;

set local role tracker_api_owner;
update public.migration_receipts set result_checksum=repeat('d',64) where user_id='b2000000-0000-0000-0000-000000000002';
reset role;
select is((select count(*) from public.migration_receipts where result_checksum=repeat('d',64)),0::bigint,'controlled role cannot update another owner receipt');

select ok(not (select rolcanlogin from pg_catalog.pg_roles where rolname='tracker_api_owner'),'tracker_api_owner remains NOLOGIN');
select ok(not (select rolbypassrls from pg_catalog.pg_roles where rolname='tracker_api_owner'),'tracker_api_owner remains NOBYPASSRLS');
select ok(not has_schema_privilege('tracker_api_owner','auth','USAGE'),'tracker_api_owner retains no Auth-schema privilege');

select * from finish();
rollback;
