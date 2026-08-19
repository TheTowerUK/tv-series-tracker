begin;
select plan(16);

select has_function('public','tracker_migrate_v1',array['jsonb'],'v1 migration RPC exists');
select function_returns('public','tracker_migrate_v1',array['jsonb'],'jsonb','v1 migration RPC returns jsonb');
select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_migrate_v1(jsonb)'::pg_catalog.regprocedure),'v1 migration RPC is security definer');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_migrate_v1(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','v1 migration RPC has restricted owner');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_migrate_v1(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'v1 migration RPC has empty search path');
select ok(has_function_privilege('authenticated','public.tracker_migrate_v1(jsonb)','EXECUTE'),'authenticated may execute v1 migration RPC');
select ok(not has_function_privilege('anon','public.tracker_migrate_v1(jsonb)','EXECUTE'),'anon cannot execute v1 migration RPC');
select ok(not has_function_privilege('public','public.tracker_migrate_v1(jsonb)','EXECUTE'),'PUBLIC cannot execute v1 migration RPC');
select ok(not has_schema_privilege('tracker_api_owner','auth','USAGE'),'migration owner has no Auth-schema privilege');
select ok(not has_schema_privilege('tracker_api_owner','public','CREATE'),'migration owner cannot create public objects after migration');
select ok(not has_schema_privilege('tracker_api_owner','tracker_private','CREATE'),'migration owner cannot create private objects after migration');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='tracker_private.owner_tracker_payload(uuid)'::pg_catalog.regprocedure),'tracker_api_owner','snapshot helper has restricted owner');
select ok(not (select prosecdef from pg_catalog.pg_proc where oid='tracker_private.owner_tracker_payload(uuid)'::pg_catalog.regprocedure),'snapshot helper is security invoker');
select is((select proconfig from pg_catalog.pg_proc where oid='tracker_private.owner_tracker_payload(uuid)'::pg_catalog.regprocedure),array['search_path=""'],'snapshot helper has empty search path');
select ok(not has_function_privilege('authenticated','tracker_private.owner_tracker_payload(uuid)','EXECUTE'),'snapshot helper is inaccessible to authenticated');
select ok((select prosrc ~ 'request.jwt.claim.sub' and prosrc ~ 'request.jwt.claims' from pg_catalog.pg_proc where oid='public.tracker_migrate_v1(jsonb)'::pg_catalog.regprocedure),'RPC uses approved caller identity extraction');

select * from finish(); rollback;
