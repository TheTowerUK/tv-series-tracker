begin;

select plan(28);

insert into auth.users(id,email) values
('30000000-0000-0000-0000-000000000003','rpc-a@example.invalid'),
('40000000-0000-0000-0000-000000000004','rpc-b@example.invalid');

create temporary table rpc_results(name text primary key,result jsonb not null);
select pg_catalog.set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true);

insert into rpc_results values ('create',public.tracker_create_show('{"platform":"Netflix","title":"RPC Show","firstAirDate":"2026-01-02","synopsis":"Synopsis","posterUrl":"https://example.invalid/poster.jpg","tmdbId":7001,"tmdbPosterPath":"/poster.jpg","seasons":[{"number":2,"status":"watching"},{"number":1,"status":"not_started"}]}'::jsonb));
select is((select result->>'outcome' from rpc_results where name='create'),'success','create-show succeeds');
select is((select count(*) from public.shows where user_id='30000000-0000-0000-0000-000000000003'),1::bigint,'create persists one owned show');
select is((select count(*) from public.season_progress where user_id='30000000-0000-0000-0000-000000000003'),2::bigint,'nested seasons are created atomically');
select is((select result#>>'{data,seasons,0,number}' from rpc_results where name='create'),'1','returned seasons are ordered');
select is(pg_catalog.jsonb_typeof((select result#>'{data,show,revision}' from rpc_results where name='create')),'string','create revision is a JSON string');
select is((select count(*) from rpc_results r cross join lateral pg_catalog.jsonb_object_keys(r.result) where r.name='create'),8::bigint,'success envelope has exactly eight top-level fields');
select ok((select result#>'{data,show}' ?& array['id','legacyId','platform','title','firstAirDate','synopsis','posterUrl','tmdbId','tmdbPosterPath','createdAt','updatedAt','revision'] from rpc_results where name='create'),'show record contains the exact contract fields');
select is((select count(*) from rpc_results r cross join lateral pg_catalog.jsonb_object_keys(r.result#>'{data,show}') where r.name='create'),12::bigint,'show record contains no extra fields');

insert into rpc_results values ('bad_nested',public.tracker_create_show('{"platform":"Test","title":"Bad nested","seasons":[{"number":1,"status":"invalid"}]}'::jsonb));
select is((select result->>'outcome' from rpc_results where name='bad_nested'),'validation_error','bad nested season is rejected');
select is((select count(*) from public.shows where user_id='30000000-0000-0000-0000-000000000003'),1::bigint,'bad nested season leaves no partial show');
insert into rpc_results values ('forged',public.tracker_create_show('{"platform":"Test","title":"Forged","id":"50000000-0000-0000-0000-000000000005"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from rpc_results where name='forged'),'unknown_field','server-owned create field is rejected');
insert into rpc_results values ('duplicate',public.tracker_create_show('{"platform":"Other","title":"Duplicate","tmdbId":7001}'::jsonb));
select is((select result#>>'{error,code}' from rpc_results where name='duplicate'),'duplicate_tmdb_id','same-owner TMDB duplicate is normalized');
select ok((select result::text !~* '(constraint|sqlstate|shows_user_tmdb|detail)' from rpc_results where name='duplicate'),'duplicate result discloses no database diagnostics');

select pg_catalog.set_config('request.jwt.claim.sub','40000000-0000-0000-0000-000000000004',true);
insert into rpc_results values ('other_owner_same_tmdb',public.tracker_create_show('{"platform":"Other","title":"Owner B","tmdbId":7001}'::jsonb));
select is((select result->>'outcome' from rpc_results where name='other_owner_same_tmdb'),'success','different owner may reuse TMDB ID');

select pg_catalog.set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true);
insert into rpc_results
select 'update',public.tracker_update_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','1','showPatch',pg_catalog.jsonb_build_object('title','Updated','posterUrl',null))) from rpc_results where name='create';
select is((select result->>'outcome' from rpc_results where name='update'),'success','update-show succeeds');
select is((select result#>>'{data,show,title}' from rpc_results where name='update'),'Updated','show patch changes permitted field');
select is((select result#>>'{data,show,revision}' from rpc_results where name='update'),'2','update increments revision exactly once as a string');
select is((select u.result#>>'{data,show,createdAt}' from rpc_results u where u.name='update'),(select c.result#>>'{data,show,createdAt}' from rpc_results c where c.name='create'),'update preserves created_at');
insert into rpc_results values ('collision_target',public.tracker_create_show('{"platform":"Test","title":"Collision target","tmdbId":7002}'::jsonb));
insert into rpc_results select 'update_duplicate',public.tracker_update_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','2','showPatch',pg_catalog.jsonb_build_object('tmdbId',7002))) from rpc_results where name='create';
select is((select result#>>'{error,code}' from rpc_results where name='update_duplicate'),'duplicate_tmdb_id','update TMDB duplicate is normalized identically');
insert into rpc_results select 'immutable_patch',public.tracker_update_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','2','showPatch',pg_catalog.jsonb_build_object('revision','9'))) from rpc_results where name='create';
select is((select result#>>'{error,fields,0,code}' from rpc_results where name='immutable_patch'),'unknown_or_immutable_field','immutable update field is rejected');
insert into rpc_results select 'stale',public.tracker_update_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','1','showPatch',pg_catalog.jsonb_build_object('title','Stale'))) from rpc_results where name='create';
select is((select result->>'outcome' from rpc_results where name='stale'),'conflict','stale update returns conflict');
select is((select result#>>'{conflict,currentRevision}' from rpc_results where name='stale'),'2','conflict returns current revision string');

insert into rpc_results values ('missing',public.tracker_update_show('{"showId":"60000000-0000-0000-0000-000000000006","expectedRevision":"1","showPatch":{"title":"Missing"}}'::jsonb));
insert into rpc_results select 'cross_owner',public.tracker_update_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','1','showPatch',pg_catalog.jsonb_build_object('title','Hidden'))) from rpc_results where name='other_owner_same_tmdb';
select is((select result->>'outcome' from rpc_results where name='missing'),(select result->>'outcome' from rpc_results where name='cross_owner'),'missing and cross-owner updates share not-found outcome');
select is((select result->'error' from rpc_results where name='missing'),(select result->'error' from rpc_results where name='cross_owner'),'missing and cross-owner updates share safe error');

insert into rpc_results select 'delete_conflict',public.tracker_delete_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','1')) from rpc_results where name='create';
select is((select result->>'outcome' from rpc_results where name='delete_conflict'),'conflict','stale delete returns conflict');
insert into rpc_results select 'delete',public.tracker_delete_show(pg_catalog.jsonb_build_object('showId',result->>'entityId','expectedRevision','2')) from rpc_results where name='create';
select is((select result#>>'{data,deleted,revision}' from rpc_results where name='delete'),'2','delete returns only safe deleted revision string');
select is((select count(*) from public.season_progress where user_id='30000000-0000-0000-0000-000000000003'),0::bigint,'show deletion cascades seasons');
select is((select count(*) from rpc_results r cross join lateral pg_catalog.jsonb_object_keys(r.result#>'{data,deleted}') where r.name='delete'),2::bigint,'delete payload contains only id and revision');

select * from finish();
rollback;
