begin;
select plan(40);

select has_function('public','tracker_restore_v2',array['jsonb'],'restore RPC exists with one jsonb request');
select function_returns('public','tracker_restore_v2',array['jsonb'],'jsonb','restore RPC returns jsonb');
select is((select prosecdef from pg_catalog.pg_proc where oid='public.tracker_restore_v2(jsonb)'::pg_catalog.regprocedure),true,'restore RPC is security definer');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='public.tracker_restore_v2(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','restore RPC has restricted owner');
select is((select proconfig from pg_catalog.pg_proc where oid='public.tracker_restore_v2(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'restore RPC has empty search path');
select ok(has_function_privilege('authenticated','public.tracker_restore_v2(jsonb)','EXECUTE'),'authenticated can execute restore');
select ok(not has_function_privilege('anon','public.tracker_restore_v2(jsonb)','EXECUTE'),'anon cannot execute restore');
select ok(not has_function_privilege('public','public.tracker_restore_v2(jsonb)','EXECUTE'),'PUBLIC cannot execute restore');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
 ('82000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','restore-one@example.invalid','',now(),now(),now()),
 ('82000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','restore-two@example.invalid','',now(),now(),now());

create temporary table restore_fx(name text primary key,value jsonb);
grant select,insert,update on restore_fx to tracker_api_owner,authenticated;
grant tracker_api_owner,authenticated to postgres;
insert into restore_fx values
('payload',jsonb_build_object('schemaVersion',2,'contractVersion','2.0.0','exportedAt','2026-08-19T12:00:00.000Z','shows',jsonb_build_array(
 jsonb_build_object('identity','cloud:82100000-0000-4000-8000-000000000001','legacyId',null,'platform','Netflix','title','Cloud Restore','firstAirDate','2020-01-02','synopsis','Cloud synopsis','posterUrl',null,'tmdbId',8201,'tmdbPosterPath','/cloud.jpg','createdAt','2026-08-18T10:00:00.000Z','updatedAt','2026-08-18T11:00:00.000Z','seasons',jsonb_build_array(jsonb_build_object('number',1,'status','watching'),jsonb_build_object('number',2,'status','not_started'))),
 jsonb_build_object('identity','legacy:legacy-restore','legacyId','legacy-restore','platform','BBC iPlayer','title','Legacy Restore','firstAirDate',null,'synopsis','','posterUrl','https://example.invalid/poster.jpg','tmdbId',null,'tmdbPosterPath',null,'createdAt','2026-08-17T10:00:00.000Z','updatedAt','2026-08-17T10:00:00.000Z','seasons',jsonb_build_array(jsonb_build_object('number',1,'status','completed')))
)));
set local role tracker_api_owner;
insert into restore_fx select 'sourceChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from restore_fx where name='payload';
insert into restore_fx values('emptyChecksum',to_jsonb(tracker_private.canonical_tracker_sha256('{"schemaVersion":2,"shows":[]}'::jsonb)));
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-0000-0000-000000000001';
insert into restore_fx values('replace',public.tracker_restore_v2(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='payload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='emptyChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));

select is((select value->>'outcome' from restore_fx where name='replace'),'success','replace restore succeeds');
select is((select value->'data'->>'mode' from restore_fx where name='replace'),'replace_cloud','replace mode is returned');
select is((select value->'data'->'receipt' from restore_fx where name='replace'),'null'::jsonb,'restore receipt is always null');
select is((select count(*) from jsonb_object_keys((select value from restore_fx where name='replace'))),8::bigint,'restore envelope has exactly eight keys');
select is((select id::text from public.shows where title='Cloud Restore'),'82100000-0000-4000-8000-000000000001','cloud UUID is preserved on insert');
select is((select legacy_id from public.shows where title='Legacy Restore'),'legacy-restore','legacy identity is preserved');
select is((select count(*) from public.shows),2::bigint,'replace restores all shows');
select is((select count(*) from public.season_progress),3::bigint,'replace restores all seasons');
select is((select value->'data'->>'resultChecksum' from restore_fx where name='replace'),(select value#>>'{}' from restore_fx where name='sourceChecksum'),'exact replacement result equals source checksum');
select is((select count(*) from public.migration_receipts),0::bigint,'restore creates no v1 receipt');
select is((select revision::text from public.shows where id='82100000-0000-4000-8000-000000000001'),'1','new restored show starts at revision one');
select is((select revision::text from public.season_progress where show_id='82100000-0000-4000-8000-000000000001' and season_number=1),'1','new restored season starts at revision one');

insert into restore_fx values('same',public.tracker_restore_v2(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='payload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));
select is((select revision::text from public.shows where id='82100000-0000-4000-8000-000000000001'),'1','unchanged show revision is preserved');
select is((select value->'data'->'shows'->>'updated' from restore_fx where name='same'),'0','unchanged replace reports no show update');

reset role;
insert into restore_fx select 'changedPayload',jsonb_set(jsonb_set(value,'{shows,0,title}','"Cloud Restore Changed"'),'{shows,0,updatedAt}','"2026-08-19T11:00:00.000Z"') from restore_fx where name='payload';
set local role tracker_api_owner;
insert into restore_fx select 'changedChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from restore_fx where name='changedPayload';
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-0000-0000-000000000001';
insert into restore_fx values('changed',public.tracker_restore_v2(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='changedPayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='changedChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));
select is((select title from public.shows where id='82100000-0000-4000-8000-000000000001'),'Cloud Restore Changed','same-owner UUID is restore target');
select is((select revision::text from public.shows where id='82100000-0000-4000-8000-000000000001'),'2','materially changed show increments once');

reset role;
insert into restore_fx select 'onePayload',jsonb_set(value,'{shows}',jsonb_build_array(value->'shows'->0)) from restore_fx where name='changedPayload';
set local role tracker_api_owner;
insert into restore_fx select 'oneChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from restore_fx where name='onePayload';
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-0000-0000-000000000001';
insert into restore_fx values('deleteAbsent',public.tracker_restore_v2(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='onePayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='oneChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='changedChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));
select is((select count(*) from public.shows),1::bigint,'replace deletes absent show');
select is((select count(*) from public.season_progress),2::bigint,'replace cascades absent show seasons');

reset role;
insert into restore_fx select 'mergePayload',jsonb_set(jsonb_set(value,'{shows,0,title}','"Reviewed Title"'),'{shows,0,updatedAt}','"2026-08-19T12:00:00.000Z"') from restore_fx where name='onePayload';
set local role tracker_api_owner;
insert into restore_fx select 'mergeChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from restore_fx where name='mergePayload';
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-0000-0000-000000000001';
insert into restore_fx values('emptyMerge',public.tracker_restore_v2(jsonb_build_object('mode','reviewed_merge','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='mergePayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='mergeChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='oneChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));
select is((select title from public.shows where id='82100000-0000-4000-8000-000000000001'),'Cloud Restore Changed','unmentioned source is ignored');
select is((select value->'data'->>'resultChecksum' from restore_fx where name='emptyMerge'),(select value#>>'{}' from restore_fx where name='oneChecksum'),'reviewed result may differ from source');

insert into restore_fx values('applyMerge',public.tracker_restore_v2(jsonb_build_object('mode','reviewed_merge','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='mergePayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='mergeChecksum'),'expectedCloudChecksum',(select value#>>'{}' from restore_fx where name='oneChecksum'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":"cloud:82100000-0000-4000-8000-000000000001","cloudIdentity":"show:82100000-0000-4000-8000-000000000001","action":"apply_local_record","expectedRevision":"2"}]}'::jsonb)));
select is((select value->>'outcome' from restore_fx where name='applyMerge'),'success','explicit reviewed apply succeeds');
select is((select title from public.shows where id='82100000-0000-4000-8000-000000000001'),'Reviewed Title','reviewed merge applies only explicit mutation');
select is((select revision::text from public.shows where id='82100000-0000-4000-8000-000000000001'),'3','reviewed material change increments once');
select is((select value->'data'->'receipt' from restore_fx where name='applyMerge'),'null'::jsonb,'reviewed restore has null receipt');

insert into restore_fx values('stale',public.tracker_restore_v2(jsonb_build_object('mode','reviewed_merge','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='changedPayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='changedChecksum'),'expectedCloudChecksum',(select value->'data'->>'resultChecksum' from restore_fx where name='applyMerge'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":"cloud:82100000-0000-4000-8000-000000000001","cloudIdentity":"show:82100000-0000-4000-8000-000000000001","action":"apply_local_record","expectedRevision":"2"}]}'::jsonb)));
select is((select value->>'outcome' from restore_fx where name='stale'),'conflict','stale reviewed revision conflicts');
select is((select title from public.shows where id='82100000-0000-4000-8000-000000000001'),'Reviewed Title','stale reviewed conflict makes no partial change');

reset role;
insert into public.shows(id,user_id,platform,title) values('82900000-0000-4000-8000-000000000009','82000000-0000-0000-0000-000000000002','Other','Private collision');
insert into restore_fx select 'collisionPayload',jsonb_set(jsonb_set(value,'{shows,0,identity}','"cloud:82900000-0000-4000-8000-000000000009"'),'{shows,0,legacyId}','null'::jsonb) from restore_fx where name='onePayload';
set local role tracker_api_owner;
insert into restore_fx select 'collisionChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from restore_fx where name='collisionPayload';
reset role;
select pg_catalog.set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000001',true);
set local role authenticated;
set local request.jwt.claim.sub='82000000-0000-0000-0000-000000000001';
insert into restore_fx values('collision',public.tracker_restore_v2(jsonb_build_object('mode','reviewed_merge','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='collisionPayload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='collisionChecksum'),'expectedCloudChecksum',(select value->'data'->>'resultChecksum' from restore_fx where name='applyMerge'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":"cloud:82900000-0000-4000-8000-000000000009","cloudIdentity":null,"action":"create_local_record","expectedRevision":null}]}'::jsonb)));
select is((select value->>'outcome' from restore_fx where name='collision'),'validation_error','cross-owner UUID collision fails safely');
select ok((select value::text !~* '(private collision|sqlstate|sqlerrm|constraint|shows_pkey)' from restore_fx where name='collision'),'collision response discloses no SQL or private record detail');

insert into restore_fx values('badContract',public.tracker_restore_v2(jsonb_set(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='payload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value->'data'->>'resultChecksum' from restore_fx where name='applyMerge'),'mergeDecisions','{"decisions":[]}'::jsonb),'{sourcePayload,contractVersion}','"2.1.0"')));
select is((select value->'error'->'fields'->0->>'path' from restore_fx where name='badContract'),'/sourcePayload/contractVersion','contract version error has deterministic pointer');
insert into restore_fx values('badExportedAt',public.tracker_restore_v2(jsonb_set(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='payload'),'sourceChecksum',(select value#>>'{}' from restore_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value->'data'->>'resultChecksum' from restore_fx where name='applyMerge'),'mergeDecisions','{"decisions":[]}'::jsonb),'{sourcePayload,exportedAt}','"2026-08-19T12:00:00Z"')));
select is((select value->'error'->'fields'->0->>'path' from restore_fx where name='badExportedAt'),'/sourcePayload/exportedAt','exportedAt error has deterministic pointer');
insert into restore_fx values('badChecksum',public.tracker_restore_v2(jsonb_build_object('mode','replace_cloud','sourceSchemaVersion',2,'sourcePayload',(select value from restore_fx where name='payload'),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value->'data'->>'resultChecksum' from restore_fx where name='applyMerge'),'mergeDecisions','{"decisions":[]}'::jsonb)));
select is((select value->'error'->>'code' from restore_fx where name='badChecksum'),'source_checksum_mismatch','source checksum mismatch is normalized');
select is((select count(*) from public.migration_receipts),0::bigint,'all restore paths leave v1 receipts untouched');

select * from finish();
rollback;
