begin;

select plan(25);

select has_function('public','tracker_create_show',array['jsonb'],'create-show RPC exists with one jsonb argument');
select has_function('public','tracker_update_show',array['jsonb'],'update-show RPC exists with one jsonb argument');
select has_function('public','tracker_delete_show',array['jsonb'],'delete-show RPC exists with one jsonb argument');

select function_returns('public','tracker_create_show',array['jsonb'],'jsonb','create-show returns jsonb');
select function_returns('public','tracker_update_show',array['jsonb'],'jsonb','update-show returns jsonb');
select function_returns('public','tracker_delete_show',array['jsonb'],'jsonb','delete-show returns jsonb');

select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_create_show(jsonb)'::pg_catalog.regprocedure),'create-show is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_update_show(jsonb)'::pg_catalog.regprocedure),'update-show is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_delete_show(jsonb)'::pg_catalog.regprocedure),'delete-show is security definer');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_create_show(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','create-show owner is restricted role');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_update_show(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','update-show owner is restricted role');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_delete_show(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','delete-show owner is restricted role');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_create_show(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'create-show has empty search path');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_update_show(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'update-show has empty search path');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_delete_show(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'delete-show has empty search path');

select ok(has_function_privilege('authenticated','public.tracker_create_show(jsonb)','EXECUTE'),'authenticated can execute create-show');
select ok(has_function_privilege('authenticated','public.tracker_update_show(jsonb)','EXECUTE'),'authenticated can execute update-show');
select ok(has_function_privilege('authenticated','public.tracker_delete_show(jsonb)','EXECUTE'),'authenticated can execute delete-show');
select ok(not has_function_privilege('anon','public.tracker_create_show(jsonb)','EXECUTE'),'anon cannot execute create-show');
select ok(not has_function_privilege('anon','public.tracker_update_show(jsonb)','EXECUTE'),'anon cannot execute update-show');
select ok(not has_function_privilege('anon','public.tracker_delete_show(jsonb)','EXECUTE'),'anon cannot execute delete-show');
select ok(not has_function_privilege('public','public.tracker_create_show(jsonb)','EXECUTE'),'PUBLIC cannot execute create-show');
select ok(not has_function_privilege('public','public.tracker_update_show(jsonb)','EXECUTE'),'PUBLIC cannot execute update-show');
select ok(not has_function_privilege('public','public.tracker_delete_show(jsonb)','EXECUTE'),'PUBLIC cannot execute delete-show');
select ok(not exists(select 1 from pg_catalog.pg_auth_members where roleid='tracker_api_owner'::pg_catalog.regrole and member='postgres'::pg_catalog.regrole and set_option),'migration runner cannot set the API-owner role after migration');

select * from finish();
rollback;
