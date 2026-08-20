begin;
select plan(18);

select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%'),7,'exactly seven public tracker RPCs exist');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and pg_catalog.pg_get_function_identity_arguments(p.oid)='request jsonb'),7,'all tracker RPCs accept exactly one jsonb request');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.prorettype='jsonb'::pg_catalog.regtype),7,'all tracker RPCs return jsonb');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.prosecdef),7,'all tracker RPCs are security definer');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.proconfig=array['search_path=""']),7,'all tracker RPCs have empty search paths');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and p.proowner='tracker_api_owner'::pg_catalog.regrole),7,'all tracker RPCs are owned by tracker_api_owner');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and has_function_privilege('authenticated',p.oid,'EXECUTE')),7,'authenticated can execute exactly seven tracker RPCs');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tracker_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('public',p.oid,'EXECUTE'))),0,'anon and PUBLIC cannot execute tracker RPCs');
select ok(not has_schema_privilege('tracker_api_owner','auth','USAGE'),'tracker_api_owner has no Auth-schema privilege');
select is((select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('shows','season_progress','migration_receipts') and c.relowner='tracker_api_owner'::pg_catalog.regrole),0,'tracker_api_owner owns no domain table');
select ok(has_table_privilege('tracker_api_owner','public.migration_receipts','SELECT,INSERT,UPDATE'),'tracker_api_owner has receipt SELECT INSERT UPDATE');
select ok(not has_table_privilege('tracker_api_owner','public.migration_receipts','DELETE'),'tracker_api_owner has no receipt DELETE grant');
select is((select count(*)::integer from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='migration_receipts' and p.polcmd='d'),0,'migration receipts have no DELETE policy');
select is((select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('shows','season_progress','migration_receipts') and c.relrowsecurity),3,'RLS is enabled on all domain tables');
select is((select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('shows','season_progress','migration_receipts') and c.relforcerowsecurity),3,'RLS is forced on all domain tables');
select ok(not has_table_privilege('authenticated','public.shows','INSERT,UPDATE,DELETE'),'authenticated show DML remains denied');
select ok(not has_table_privilege('authenticated','public.season_progress','INSERT,UPDATE,DELETE'),'authenticated season DML remains denied');
select ok(not has_table_privilege('authenticated','public.migration_receipts','INSERT,UPDATE,DELETE'),'authenticated receipt DML remains denied');

select * from finish();
rollback;
