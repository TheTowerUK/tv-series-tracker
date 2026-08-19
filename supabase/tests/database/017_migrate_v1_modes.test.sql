begin;
select plan(35);

insert into auth.users(id,email) values
 ('81000000-0000-0000-0000-000000000001','modes-owner@example.invalid'),
 ('82000000-0000-0000-0000-000000000002','modes-other@example.invalid');
insert into public.shows(id,user_id,legacy_id,platform,title,created_at,updated_at) values
 ('81100000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','a','TV','Cloud A','2026-01-01Z','2026-01-01Z'),
 ('81100000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','b','TV','Delete B','2026-01-01Z','2026-01-01Z'),
 ('81100000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001','k','TV','Keep K','2026-01-01Z','2026-01-01Z'),
 ('81100000-0000-0000-0000-000000000004','81000000-0000-0000-0000-000000000001','u','TV','Unmentioned U','2026-01-01Z','2026-01-01Z'),
 ('82100000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002','other','TV','Other owner','2026-01-01Z','2026-01-01Z');
insert into public.season_progress(id,show_id,user_id,season_number,status,created_at,updated_at) values
 ('81200000-0000-0000-0000-000000000001','81100000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001',1,'completed','2026-01-01Z','2026-01-01Z'),
 ('81200000-0000-0000-0000-000000000002','81100000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001',2,'not_started','2026-01-01Z','2026-01-01Z'),
 ('81200000-0000-0000-0000-000000000003','81100000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001',3,'watching','2026-01-01Z','2026-01-01Z'),
 ('81200000-0000-0000-0000-000000000004','81100000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001',1,'watching','2026-01-01Z','2026-01-01Z');

create temporary table mode_fx(name text primary key,value jsonb not null);
grant select,insert,update on mode_fx to tracker_api_owner,authenticated;
grant tracker_api_owner,authenticated to postgres;
insert into mode_fx values
('raw',$j${"schemaVersion":1,"shows":[{"id":"a","platform":"Netflix","title":"Local A","firstAirDate":"2020-01-01","description":"A","posterUrl":"","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-02-01T00:00:00.000Z","seasons":[{"number":1,"status":"Completed"},{"number":2,"status":"Watching"},{"number":3,"status":"Watching"}]},{"id":"c","platform":"TV","title":"Create C","firstAirDate":"","description":"","posterUrl":"","createdAt":"2026-03-01T00:00:00.000Z","updatedAt":"2026-03-01T00:00:00.000Z","seasons":[{"number":1,"status":"Not Started"}]},{"id":"d","platform":"TV","title":"Ignored D","firstAirDate":"","createdAt":"2026-04-01T00:00:00.000Z","updatedAt":"2026-04-01T00:00:00.000Z","seasons":[]}]}$j$::jsonb),
('normalized',$j${"schemaVersion":2,"shows":[{"identity":"legacy:a","legacyId":"a","platform":"Netflix","title":"Local A","firstAirDate":"2020-01-01","synopsis":"A","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-02-01T00:00:00.000Z","seasons":[{"number":1,"status":"completed"},{"number":2,"status":"watching"},{"number":3,"status":"watching"}]},{"identity":"legacy:c","legacyId":"c","platform":"TV","title":"Create C","firstAirDate":null,"synopsis":"","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-03-01T00:00:00.000Z","updatedAt":"2026-03-01T00:00:00.000Z","seasons":[{"number":1,"status":"not_started"}]},{"identity":"legacy:d","legacyId":"d","platform":"TV","title":"Ignored D","firstAirDate":null,"synopsis":"","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-04-01T00:00:00.000Z","updatedAt":"2026-04-01T00:00:00.000Z","seasons":[]}]}$j$::jsonb);
insert into mode_fx select 'rawChanged',jsonb_set(value,'{shows,2,title}','"Changed ignored D"'::jsonb) from mode_fx where name='raw';
insert into mode_fx select 'normalizedChanged',jsonb_set(value,'{shows,2,title}','"Changed ignored D"'::jsonb) from mode_fx where name='normalized';
insert into mode_fx select 'rawLate',jsonb_set(value,'{shows,0,title}','"Late A"'::jsonb) from mode_fx where name='raw';
insert into mode_fx select 'normalizedLate',jsonb_set(value,'{shows,0,title}','"Late A"'::jsonb) from mode_fx where name='normalized';
select pg_catalog.set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
set local role tracker_api_owner;
insert into mode_fx select 'sourceChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from mode_fx where name='normalized';
insert into mode_fx select 'changedChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from mode_fx where name='normalizedChanged';
insert into mode_fx select 'lateChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(value)) from mode_fx where name='normalizedLate';
insert into mode_fx values('cloudChecksum',to_jsonb(tracker_private.canonical_tracker_sha256(tracker_private.owner_tracker_payload('81000000-0000-0000-0000-000000000001'))));
reset role;

create temporary table before_keep as select id,revision,created_at,updated_at,title from public.shows where user_id='81000000-0000-0000-0000-000000000001';
select pg_catalog.set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into mode_fx values('keep',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','keep_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='raw'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='sourceChecksum'),'expectedCloudChecksum',repeat('f',64),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value->>'outcome' from mode_fx where name='keep'),'success','keep-cloud succeeds despite stale expected cloud checksum');
select is((select value#>>'{data,receipt}' from mode_fx where name='keep'),null,'keep-cloud returns null receipt');
select is((select count(*) from public.migration_receipts where user_id='81000000-0000-0000-0000-000000000001'),0::bigint,'keep-cloud writes no receipt');
select is((select count(*) from public.shows s join before_keep b using(id) where s.revision=b.revision and s.created_at=b.created_at and s.updated_at=b.updated_at and s.title=b.title),4::bigint,'keep-cloud preserves show data revisions and timestamps');
select is((select value#>>'{data,shows,unchanged}' from mode_fx where name='keep'),'4','keep-cloud reports current shows unchanged');
select is((select value#>>'{data,resultChecksum}' from mode_fx where name='keep'),(select value#>>'{}' from mode_fx where name='cloudChecksum'),'keep-cloud returns verified current checksum');

insert into mode_fx values('decisions',$j${"decisions":[
 {"entityType":"season","sourceIdentity":"legacy:c/season:1","cloudIdentity":null,"action":"create_local_season","expectedRevision":null},
 {"entityType":"show","sourceIdentity":null,"cloudIdentity":"show:81100000-0000-0000-0000-000000000003","action":"keep_cloud_record","expectedRevision":null},
 {"entityType":"show","sourceIdentity":"legacy:a","cloudIdentity":"show:81100000-0000-0000-0000-000000000001","action":"apply_local_record","expectedRevision":"1"},
 {"entityType":"show","sourceIdentity":"legacy:c","cloudIdentity":null,"action":"create_local_record","expectedRevision":null},
 {"entityType":"show","sourceIdentity":null,"cloudIdentity":"show:81100000-0000-0000-0000-000000000002","action":"delete_cloud_record","expectedRevision":"1"},
 {"entityType":"season","sourceIdentity":"legacy:a/season:1","cloudIdentity":"show:81100000-0000-0000-0000-000000000001/season:1","action":"keep_cloud_season","expectedRevision":null},
 {"entityType":"season","sourceIdentity":"legacy:a/season:2","cloudIdentity":"show:81100000-0000-0000-0000-000000000001/season:2","action":"apply_local_season","expectedRevision":"1"},
 {"entityType":"season","sourceIdentity":null,"cloudIdentity":"show:81100000-0000-0000-0000-000000000001/season:3","action":"delete_cloud_season","expectedRevision":"1"}
]}$j$::jsonb);
set local role authenticated;
insert into mode_fx values('merge',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='raw'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='cloudChecksum'),'mergeDecisions',(select value from mode_fx where name='decisions'))));
reset role;
select is((select value->>'outcome' from mode_fx where name='merge'),'success','reviewed merge succeeds');
select is((select title from public.shows where id='81100000-0000-0000-0000-000000000001'),'Local A','apply-local show action applies source');
select is((select revision::text from public.shows where id='81100000-0000-0000-0000-000000000001'),'2','applied show increments revision once');
select is((select count(*) from public.shows where legacy_id='c' and user_id='81000000-0000-0000-0000-000000000001'),1::bigint,'create-local show action creates source show');
select is((select count(*) from public.shows where id='81100000-0000-0000-0000-000000000002'),0::bigint,'delete-cloud show action deletes target');
select is((select title from public.shows where id='81100000-0000-0000-0000-000000000003'),'Keep K','keep-cloud show action preserves target');
select is((select title from public.shows where id='81100000-0000-0000-0000-000000000004'),'Unmentioned U','unmentioned cloud show is preserved');
select is((select count(*) from public.shows where legacy_id='d'),0::bigint,'unmentioned local show is ignored');
select is((select status::text from public.season_progress where id='81200000-0000-0000-0000-000000000001'),'completed','keep-cloud season action preserves status');
select is((select status::text from public.season_progress where id='81200000-0000-0000-0000-000000000002'),'watching','apply-local season action applies status');
select is((select revision::text from public.season_progress where id='81200000-0000-0000-0000-000000000002'),'2','applied season increments revision once');
select is((select count(*) from public.season_progress where id='81200000-0000-0000-0000-000000000003'),0::bigint,'delete-cloud season action deletes target');
select is((select count(*) from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='c' and sp.season_number=1),1::bigint,'new show resolves source season creation regardless of decision order');
select is((select count(*) from public.migration_receipts where user_id='81000000-0000-0000-0000-000000000001'),1::bigint,'reviewed merge creates receipt');
select isnt((select value#>>'{data,resultChecksum}' from mode_fx where name='merge'),(select value#>>'{}' from mode_fx where name='sourceChecksum'),'reviewed merge result checksum may differ from source');
select is((select count(*) from public.shows where user_id='82000000-0000-0000-0000-000000000002'),1::bigint,'reviewed merge preserves other owner');

insert into mode_fx select 'mergedChecksum',value#>'{data,resultChecksum}' from mode_fx where name='merge';
create temporary table receipt_before as select * from public.migration_receipts where user_id='81000000-0000-0000-0000-000000000001';
set local role authenticated;
insert into mode_fx values('retry',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='raw'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions',(select value from mode_fx where name='decisions'))));
reset role;
select is((select value->>'outcome' from mode_fx where name='retry'),'success','reviewed merge retry succeeds despite now-stale decision revisions');
select is((select value#>>'{data,shows,updated}' from mode_fx where name='retry'),'0','idempotent reviewed retry reports zero updates');
select ok((select completed_at=(select completed_at from receipt_before) from public.migration_receipts where user_id='81000000-0000-0000-0000-000000000001'),'idempotent reviewed retry preserves receipt');

set local role authenticated;
insert into mode_fx values('duplicate',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='raw'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions',jsonb_build_object('decisions',jsonb_build_array((select value->'decisions'->1 from mode_fx where name='decisions'),(select value->'decisions'->1 from mode_fx where name='decisions'))))));
insert into mode_fx values('parent_child',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='raw'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='sourceChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":null,"cloudIdentity":"show:81100000-0000-0000-0000-000000000001","action":"delete_cloud_record","expectedRevision":"2"},{"entityType":"season","sourceIdentity":null,"cloudIdentity":"show:81100000-0000-0000-0000-000000000001/season:1","action":"delete_cloud_season","expectedRevision":"1"}]}'::jsonb)));
reset role;
select is((select value#>>'{error,code}' from mode_fx where name='duplicate'),'duplicate_decision','duplicate decisions are rejected');
select is((select value#>>'{error,code}' from mode_fx where name='parent_child'),'parent_child_conflict','parent delete with child decision is rejected');
select ok(pg_catalog.strpos((select value::text from mode_fx where name='parent_child'),'constraint')=0,'decision errors disclose no database diagnostics');

set local role authenticated;
insert into mode_fx values('stale',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='rawChanged'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='changedChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":"legacy:a","cloudIdentity":"show:81100000-0000-0000-0000-000000000001","action":"apply_local_record","expectedRevision":"1"}]}'::jsonb)));
reset role;
select is((select value->>'outcome' from mode_fx where name='stale'),'conflict','stale reviewed decision returns conflict');
select is((select revision::text from public.shows where id='81100000-0000-0000-0000-000000000001'),'2','stale decision performs no mutation');

set local role authenticated;
insert into mode_fx values('changed_source',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='rawChanged'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='changedChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value->>'outcome' from mode_fx where name='changed_source'),'success','changed source is reviewed rather than silently treated as prior completion');
select is((select source_checksum from public.migration_receipts where user_id='81000000-0000-0000-0000-000000000001'),(select value#>>'{}' from mode_fx where name='changedChecksum'),'changed-source reviewed execution updates verified receipt');

create function pg_temp.fail_receipt_update() returns trigger language plpgsql as $$begin raise exception 'test late failure'; end$$;
create trigger fail_receipt_update before update on public.migration_receipts for each row execute function pg_temp.fail_receipt_update();
set local role authenticated;
insert into mode_fx values('late_failure',public.tracker_migrate_v1(jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','reviewed_merge','sourceSchemaVersion',1,'sourcePayload',(select value from mode_fx where name='rawLate'),'sourceChecksum',(select value#>>'{}' from mode_fx where name='lateChecksum'),'expectedCloudChecksum',(select value#>>'{}' from mode_fx where name='mergedChecksum'),'mergeDecisions','{"decisions":[{"entityType":"show","sourceIdentity":"legacy:a","cloudIdentity":"show:81100000-0000-0000-0000-000000000001","action":"apply_local_record","expectedRevision":"2"}]}'::jsonb)));
reset role;
drop trigger fail_receipt_update on public.migration_receipts;
select is((select value->>'outcome' from mode_fx where name='late_failure'),'internal_error','late receipt failure is normalized safely');
select is((select title from public.shows where id='81100000-0000-0000-0000-000000000001'),'Local A','late failure rolls back reviewed show mutation');
select is((select revision::text from public.shows where id='81100000-0000-0000-0000-000000000001'),'2','late failure rolls back reviewed revision increment');

select * from finish(); rollback;
