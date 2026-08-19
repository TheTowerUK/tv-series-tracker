begin;

select plan(35);

insert into auth.users(id,email) values
('a0000000-0000-0000-0000-00000000000a','season-a@example.invalid'),
('b0000000-0000-0000-0000-00000000000b','season-b@example.invalid');
insert into public.shows(id,user_id,platform,title) values
('aa000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Test','Owner A'),
('bb000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-00000000000b','Test','Owner B');

create temporary table season_results(name text primary key,result jsonb not null);
select pg_catalog.set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',true);

insert into season_results values('create',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":null,"status":"not_started"}'::jsonb));
select is((select result->>'outcome' from season_results where name='create'),'success','create-only season succeeds');
select is((select result#>>'{data,created}' from season_results where name='create'),'true','create-only reports created');
select is((select result#>>'{data,season,revision}' from season_results where name='create'),'1','created revision is decimal string');
select is((select count(*) from season_results r cross join lateral pg_catalog.jsonb_object_keys(r.result) where r.name='create'),8::bigint,'season success has exact eight-field envelope');
select is((select count(*) from season_results r cross join lateral pg_catalog.jsonb_object_keys(r.result#>'{data,season}') where r.name='create'),7::bigint,'season record has exact seven fields');
select is((select user_id from public.season_progress where id=(select (result->>'entityId')::uuid from season_results where name='create')),'a0000000-0000-0000-0000-00000000000a'::uuid,'server derives season owner from caller');

insert into season_results values('duplicate',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":null,"status":"watching"}'::jsonb));
select is((select result->>'outcome' from season_results where name='duplicate'),'conflict','existing season create-only returns conflict');
select is((select result#>>'{conflict,expectedRevision}' from season_results where name='duplicate'),null,'create-only conflict has null expected revision');
select ok((select result::text !~* '(constraint|sqlstate|detail|hint|season_progress_show_id_season)' from season_results where name='duplicate'),'duplicate conflict exposes no SQL diagnostics');

insert into season_results values('bad_number',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":0,"expectedRevision":null,"status":"watching"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='bad_number'),'invalid_season_number','invalid season number is rejected');
insert into season_results values('bad_status',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":2,"expectedRevision":null,"status":"invalid"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='bad_status'),'invalid_status','invalid status is rejected');
insert into season_results values('bad_revision_type',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":1,"status":"watching"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='bad_revision_type'),'invalid_revision','numeric expected revision is rejected');
insert into season_results values('bad_revision_range',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"9223372036854775808","status":"watching"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='bad_revision_range'),'invalid_revision','out-of-range expected revision is rejected');
insert into season_results values('immutable',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":2,"expectedRevision":null,"status":"watching","id":"cc000000-0000-0000-0000-00000000000c"}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='immutable'),'unknown_field','server-owned season field is rejected');

insert into season_results values('update',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"1","status":"watching"}'::jsonb));
select is((select result->>'outcome' from season_results where name='update'),'success','update-only season succeeds');
select is((select result#>>'{data,created}' from season_results where name='update'),'false','update-only reports not created');
select is((select result#>>'{data,season,status}' from season_results where name='update'),'watching','update changes status');
select is((select result#>>'{data,season,revision}' from season_results where name='update'),'2','update increments revision exactly once');
select is((select c.result#>>'{data,season,createdAt}' from season_results c where c.name='create'),(select u.result#>>'{data,season,createdAt}' from season_results u where u.name='update'),'update preserves created timestamp');
insert into season_results values('stale',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"1","status":"completed"}'::jsonb));
select is((select result->>'outcome' from season_results where name='stale'),'conflict','stale update returns conflict');
select is((select result#>>'{conflict,currentRevision}' from season_results where name='stale'),'2','stale conflict returns current revision string');

insert into season_results values('missing',public.tracker_upsert_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":2,"expectedRevision":"1","status":"watching"}'::jsonb));
insert into season_results values('cross_owner',public.tracker_upsert_season('{"showId":"bb000000-0000-0000-0000-00000000000b","seasonNumber":2,"expectedRevision":"1","status":"watching"}'::jsonb));
select is((select result->>'outcome' from season_results where name='missing'),(select result->>'outcome' from season_results where name='cross_owner'),'missing and cross-owner update share not-found outcome');
select is((select result->'error' from season_results where name='missing'),(select result->'error' from season_results where name='cross_owner'),'missing and cross-owner update share safe error');

select pg_catalog.set_config('request.jwt.claim.sub','',true);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b0000000-0000-0000-0000-00000000000b"}',true);
insert into season_results values('fallback_owner',public.tracker_upsert_season('{"showId":"bb000000-0000-0000-0000-00000000000b","seasonNumber":1,"expectedRevision":null,"status":"completed"}'::jsonb));
select is((select result->>'outcome' from season_results where name='fallback_owner'),'success','season RPC supports approved JSON-claims identity fallback');
select is((select user_id from public.season_progress where id=(select (result->>'entityId')::uuid from season_results where name='fallback_owner')),'b0000000-0000-0000-0000-00000000000b'::uuid,'fallback identity owns only its season');

select pg_catalog.set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-00000000000a',true);
select pg_catalog.set_config('request.jwt.claims','',true);
insert into season_results values('delete_stale',public.tracker_delete_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"1"}'::jsonb));
select is((select result->>'outcome' from season_results where name='delete_stale'),'conflict','stale delete returns conflict');
insert into season_results values('delete',public.tracker_delete_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"2"}'::jsonb));
select is((select result->>'outcome' from season_results where name='delete'),'success','current revision deletes season');
select is((select result#>>'{data,deleted,revision}' from season_results where name='delete'),'2','delete returns deleted revision string');
select is((select count(*) from season_results r cross join lateral pg_catalog.jsonb_object_keys(r.result#>'{data,deleted}') where r.name='delete'),4::bigint,'delete returns only safe identity and revision fields');
select is((select count(*) from public.season_progress where show_id='aa000000-0000-0000-0000-00000000000a'),0::bigint,'deleted season is absent');

insert into season_results values('delete_bad_revision',public.tracker_delete_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":2}'::jsonb));
select is((select result#>>'{error,fields,0,code}' from season_results where name='delete_bad_revision'),'invalid_revision','delete rejects non-string expected revision');
insert into season_results values('delete_missing',public.tracker_delete_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":9,"expectedRevision":"1"}'::jsonb));
insert into season_results values('delete_cross_owner',public.tracker_delete_season('{"showId":"bb000000-0000-0000-0000-00000000000b","seasonNumber":1,"expectedRevision":"1"}'::jsonb));
select is((select result->>'outcome' from season_results where name='delete_missing'),(select result->>'outcome' from season_results where name='delete_cross_owner'),'missing and cross-owner delete share not-found outcome');
select is((select result->'error' from season_results where name='delete_missing'),(select result->'error' from season_results where name='delete_cross_owner'),'missing and cross-owner delete share safe error');

select pg_catalog.set_config('request.jwt.claim.sub','not-a-uuid',true);
insert into season_results values('malformed_claim',public.tracker_delete_season('{"showId":"aa000000-0000-0000-0000-00000000000a","seasonNumber":1,"expectedRevision":"2"}'::jsonb));
select is((select result#>>'{error,message}' from season_results where name='malformed_claim'),'The operation could not be completed.','malformed caller claim returns safe generic error');
select ok((select result::text !~* '(invalid input syntax|uuid|sqlstate|constraint|detail|hint)' from season_results where name='malformed_claim'),'malformed caller claim discloses no SQL diagnostics');

select * from finish();
rollback;
