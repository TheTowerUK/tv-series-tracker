begin;

select plan(22);

select is(
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%'),
  6,
  'five Phase 2.3 functions plus the Phase 2.4 v1 migration function exist'
);
select is(
  (select pg_catalog.string_agg(p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',',' order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%'),
  'tracker_create_show(request jsonb),tracker_delete_season(request jsonb),tracker_delete_show(request jsonb),tracker_migrate_v1(request jsonb),tracker_update_show(request jsonb),tracker_upsert_season(request jsonb)',
  'tracker function names and signatures match exactly'
);
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.prorettype='jsonb'::pg_catalog.regtype),6,'all tracker functions return jsonb');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.prosecdef),6,'all tracker functions are security definer');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.proowner='tracker_api_owner'::pg_catalog.regrole),6,'all tracker functions have the restricted owner');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.proconfig=array['search_path=""']),6,'all tracker functions have an empty search path');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and has_function_privilege('authenticated',p.oid,'EXECUTE')),6,'authenticated can execute exactly the six implemented functions');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('public',p.oid,'EXECUTE'))),0,'anon and PUBLIC cannot execute tracker functions');
select ok(not has_schema_privilege('tracker_api_owner','auth','USAGE'),'function owner has no Auth-schema usage');
select ok(has_table_privilege('tracker_api_owner','public.migration_receipts','INSERT,UPDATE'),'Phase 2.4 function owner can insert and update receipts');
select ok(not has_table_privilege('tracker_api_owner','public.migration_receipts','DELETE'),'receipt delete capability remains absent');
select ok(not has_table_privilege('authenticated','public.shows','INSERT,UPDATE,DELETE'),'authenticated direct show DML remains denied');
select ok(not has_table_privilege('authenticated','public.season_progress','INSERT,UPDATE,DELETE'),'authenticated direct season DML remains denied');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.prosrc ~* '(sqlerrm|pg_exception|constraint_name|message_text)'),0,'tracker sources do not read PostgreSQL diagnostics');

insert into auth.users(id,email) values('c0000000-0000-0000-0000-00000000000c','cascade@example.invalid');
insert into public.shows(id,user_id,platform,title) values('cc000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-00000000000c','Test','Cascade show');
insert into public.season_progress(show_id,user_id,season_number) values('cc000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-00000000000c',1);
delete from public.shows where id='cc000000-0000-0000-0000-00000000000c';
select is((select count(*) from public.season_progress where show_id='cc000000-0000-0000-0000-00000000000c'),0::bigint,'show deletion cascades its seasons');

insert into public.shows(id,user_id,platform,title) values('cc000000-0000-0000-0000-00000000000d','c0000000-0000-0000-0000-00000000000c','Test','Account cascade');
insert into public.season_progress(show_id,user_id,season_number) values('cc000000-0000-0000-0000-00000000000d','c0000000-0000-0000-0000-00000000000c',1);
insert into public.migration_receipts(user_id,migration_key,source_schema_version,source_checksum,result_checksum) values('c0000000-0000-0000-0000-00000000000c','closure',1,repeat('c',64),repeat('c',64));
delete from auth.users where id='c0000000-0000-0000-0000-00000000000c';
select is((select count(*) from public.shows where user_id='c0000000-0000-0000-0000-00000000000c'),0::bigint,'Auth-user deletion removes owned shows');
select is((select count(*) from public.season_progress where user_id='c0000000-0000-0000-0000-00000000000c'),0::bigint,'Auth-user deletion removes owned seasons');
select is((select count(*) from public.migration_receipts where user_id='c0000000-0000-0000-0000-00000000000c'),0::bigint,'Auth-user deletion removes owned receipts');

insert into auth.users(id,email) values('d0000000-0000-0000-0000-00000000000d','metadata@example.invalid');
select pg_catalog.set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-00000000000d',true);
create temporary table closure_results(name text primary key,result jsonb not null);
insert into closure_results values('ordered_validation',public.tracker_create_show('{"platform":"Test","title":"Ordered","zField":1,"aField":2}'::jsonb));
select is((select result#>>'{error,fields,0,path}' from closure_results where name='ordered_validation'),'/aField','unknown fields are reported deterministically in lexical order');
insert into closure_results values('forged_metadata',public.tracker_create_show('{"platform":"Test","title":"Forged","id":"de000000-0000-0000-0000-00000000000d","userId":"c0000000-0000-0000-0000-00000000000c","createdAt":"2000-01-01T00:00:00Z","updatedAt":"2000-01-01T00:00:00Z","revision":"99"}'::jsonb));
select is((select result->>'outcome' from closure_results where name='forged_metadata'),'validation_error','forged server metadata is rejected');
select is((select result#>>'{error,fields,0,path}' from closure_results where name='forged_metadata'),'/createdAt','forged metadata validation order is deterministic');
select is((select count(*) from public.shows where user_id='d0000000-0000-0000-0000-00000000000d'),0::bigint,'metadata-forging request creates no row');

select * from finish();
rollback;
