begin;

select plan(16);

select has_function('public','tracker_upsert_season',array['jsonb'],'upsert-season RPC exists with one jsonb argument');
select has_function('public','tracker_delete_season',array['jsonb'],'delete-season RPC exists with one jsonb argument');
select function_returns('public','tracker_upsert_season',array['jsonb'],'jsonb','upsert-season returns jsonb');
select function_returns('public','tracker_delete_season',array['jsonb'],'jsonb','delete-season returns jsonb');
select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_upsert_season(jsonb)'::pg_catalog.regprocedure),'upsert-season is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_delete_season(jsonb)'::pg_catalog.regprocedure),'delete-season is security definer');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_upsert_season(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','upsert-season owner is restricted role');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_delete_season(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','delete-season owner is restricted role');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_upsert_season(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'upsert-season has empty search path');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_delete_season(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'delete-season has empty search path');
select ok(has_function_privilege('authenticated','public.tracker_upsert_season(jsonb)','EXECUTE'),'authenticated can execute upsert-season');
select ok(has_function_privilege('authenticated','public.tracker_delete_season(jsonb)','EXECUTE'),'authenticated can execute delete-season');
select ok(not has_function_privilege('anon','public.tracker_upsert_season(jsonb)','EXECUTE') and not has_function_privilege('public','public.tracker_upsert_season(jsonb)','EXECUTE'),'anon and PUBLIC cannot execute upsert-season');
select ok(not has_function_privilege('anon','public.tracker_delete_season(jsonb)','EXECUTE') and not has_function_privilege('public','public.tracker_delete_season(jsonb)','EXECUTE'),'anon and PUBLIC cannot execute delete-season');
select ok(not has_schema_privilege('tracker_api_owner','auth','USAGE'),'season RPC owner has no Auth-schema usage');
select ok(not exists(select 1 from pg_catalog.pg_auth_members where roleid='tracker_api_owner'::pg_catalog.regrole and member='postgres'::pg_catalog.regrole and set_option),'migration runner cannot set API-owner role after season migrations');

select * from finish();
rollback;
