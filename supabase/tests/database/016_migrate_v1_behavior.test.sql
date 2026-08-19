begin;
select plan(40);

insert into auth.users(id,email) values
 ('71000000-0000-0000-0000-000000000001','migration-owner@example.invalid'),
 ('72000000-0000-0000-0000-000000000002','migration-other@example.invalid');
insert into public.shows(id,user_id,legacy_id,platform,title) values
 ('72000000-0000-0000-0000-000000000020','72000000-0000-0000-0000-000000000002','other-1','Other','Private other');

create temporary table migrate_fixture(name text primary key,value jsonb not null);
grant select,insert,update on migrate_fixture to tracker_api_owner,authenticated;
grant tracker_api_owner,authenticated to postgres;

insert into migrate_fixture values
('raw1',$j${"schemaVersion":1,"shows":[{"id":"tv-0001","platform":"Netflix","title":"Alpha","firstAirDate":"2020-01-02","description":"Alpha synopsis","posterUrl":"","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-15T00:00:00.000Z","tmdb":{"id":101,"name":"TMDB Alpha","firstAirDate":"2019-01-01","posterPath":"/a.jpg"},"tmdbId":101,"tmdbPosterPath":"/a.jpg","seasons":[{"number":2,"status":"Watching"},{"number":1,"status":"Completed"}]},{"id":"tv-0002","platform":"TV","title":"Beta","firstAirDate":"","createdAt":"2026-08-16T00:00:00Z","updatedAt":"2026-08-16T00:00:00Z","seasons":[{"number":1,"status":"Purchase Only"},{"number":2,"status":"Not Started"},{"number":3,"status":"Region Blocked"}]}]}$j$::jsonb),
('normalized1',$j${"schemaVersion":2,"shows":[{"identity":"legacy:tv-0001","legacyId":"tv-0001","platform":"Netflix","title":"Alpha","firstAirDate":"2020-01-02","synopsis":"Alpha synopsis","posterUrl":null,"tmdbId":101,"tmdbPosterPath":"/a.jpg","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-15T00:00:00.000Z","seasons":[{"number":1,"status":"completed"},{"number":2,"status":"watching"}]},{"identity":"legacy:tv-0002","legacyId":"tv-0002","platform":"TV","title":"Beta","firstAirDate":null,"synopsis":"","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-08-16T00:00:00.000Z","updatedAt":"2026-08-16T00:00:00.000Z","seasons":[{"number":1,"status":"purchase_only"},{"number":2,"status":"not_started"},{"number":3,"status":"region_blocked"}]}]}$j$::jsonb),
('raw2',$j${"schemaVersion":1,"shows":[{"id":"tv-0001","platform":"Netflix","title":"Alpha revised","firstAirDate":"2020-01-02","description":"Alpha synopsis","posterUrl":"","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-17T00:00:00.000Z","tmdbId":101,"tmdbPosterPath":"/a.jpg","seasons":[{"number":1,"status":"Completed"}]}]}$j$::jsonb),
('normalized2',$j${"schemaVersion":2,"shows":[{"identity":"legacy:tv-0001","legacyId":"tv-0001","platform":"Netflix","title":"Alpha revised","firstAirDate":"2020-01-02","synopsis":"Alpha synopsis","posterUrl":null,"tmdbId":101,"tmdbPosterPath":"/a.jpg","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-17T00:00:00.000Z","seasons":[{"number":1,"status":"completed"}]}]}$j$::jsonb),
('raw3',$j${"schemaVersion":1,"shows":[{"id":"tv-0001","platform":"Netflix","title":"Late failure","firstAirDate":"2020-01-02","description":"Alpha synopsis","posterUrl":"","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-18T00:00:00.000Z","tmdbId":101,"tmdbPosterPath":"/a.jpg","seasons":[{"number":1,"status":"Completed"}]}]}$j$::jsonb),
('normalized3',$j${"schemaVersion":2,"shows":[{"identity":"legacy:tv-0001","legacyId":"tv-0001","platform":"Netflix","title":"Late failure","firstAirDate":"2020-01-02","synopsis":"Alpha synopsis","posterUrl":null,"tmdbId":101,"tmdbPosterPath":"/a.jpg","createdAt":"2026-08-15T00:00:00.000Z","updatedAt":"2026-08-18T00:00:00.000Z","seasons":[{"number":1,"status":"completed"}]}]}$j$::jsonb);

set local role tracker_api_owner;
insert into migrate_fixture values('emptyChecksum',pg_catalog.to_jsonb(tracker_private.canonical_tracker_sha256('{"schemaVersion":2,"shows":[]}'::jsonb)));
insert into migrate_fixture select 'checksum1',pg_catalog.to_jsonb(tracker_private.canonical_tracker_sha256(value)) from migrate_fixture where name='normalized1';
insert into migrate_fixture select 'checksum2',pg_catalog.to_jsonb(tracker_private.canonical_tracker_sha256(value)) from migrate_fixture where name='normalized2';
insert into migrate_fixture select 'checksum3',pg_catalog.to_jsonb(tracker_private.canonical_tracker_sha256(value)) from migrate_fixture where name='normalized3';
reset role;

select pg_catalog.set_config('request.jwt.claim.sub','71000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into migrate_fixture values('result1',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw1'),'sourceChecksum',(select value#>>'{}' from migrate_fixture where name='checksum1'),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='emptyChecksum'),'mergeDecisions',pg_catalog.jsonb_build_object('decisions','[]'::jsonb))));
reset role;

select is((select value->>'outcome' from migrate_fixture where name='result1'),'success','empty-cloud replacement succeeds');
select is((select count(*) from public.shows where user_id='71000000-0000-0000-0000-000000000001'),2::bigint,'two mapped shows inserted');
select is((select count(*) from public.season_progress where user_id='71000000-0000-0000-0000-000000000001'),5::bigint,'five mapped seasons inserted');
select is((select status::text from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='tv-0001' and sp.season_number=2),'watching','v1 Watching status maps correctly');
select is((select status::text from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='tv-0002' and sp.season_number=1),'purchase_only','v1 Purchase Only status maps correctly');
select is((select status::text from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='tv-0002' and sp.season_number=2),'not_started','v1 Not Started status maps correctly');
select is((select status::text from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='tv-0002' and sp.season_number=3),'region_blocked','v1 Region Blocked status maps correctly');
select is((select tmdb_id from public.shows where legacy_id='tv-0001'),101,'matching nested/top-level TMDB ID is preserved');
select is((select poster_url from public.shows where legacy_id='tv-0001'),null,'blank poster URL maps to null independently');
select is((select revision::text from public.shows where legacy_id='tv-0001'),'1','new show starts at revision one');
select is((select min(revision)::text from public.season_progress where user_id='71000000-0000-0000-0000-000000000001'),'1','new seasons start at revision one');
select is((select value#>>'{data,resultChecksum}' from migrate_fixture where name='result1'),(select value#>>'{}' from migrate_fixture where name='checksum1'),'result checksum equals source checksum');
select is((select count(*) from public.migration_receipts where user_id='71000000-0000-0000-0000-000000000001'),1::bigint,'verified migration creates one receipt');
select is((select count(*) from public.shows where user_id='72000000-0000-0000-0000-000000000002'),1::bigint,'other owner remains unchanged');
select is((select count(*)::integer from migrate_fixture m cross join lateral pg_catalog.jsonb_object_keys(m.value) where m.name='result1'),8,'success uses exact eight-field envelope');

create temporary table preserved as select id,revision,created_at,updated_at from public.shows where user_id='71000000-0000-0000-0000-000000000001';
create temporary table preserved_receipt as select * from public.migration_receipts where user_id='71000000-0000-0000-0000-000000000001';
grant select on preserved,preserved_receipt to authenticated;
set local role authenticated;
insert into migrate_fixture values('retry1',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw1'),'sourceChecksum',(select value#>>'{}' from migrate_fixture where name='checksum1'),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum1'),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value#>>'{data,shows,inserted}' from migrate_fixture where name='retry1'),'0','idempotent retry reports zero show inserts');
select is((select value#>>'{data,shows,unchanged}' from migrate_fixture where name='retry1'),'2','idempotent retry reports current shows unchanged');
select is((select count(*) from public.shows s join preserved p using(id) where s.revision=p.revision and s.created_at=p.created_at and s.updated_at=p.updated_at),2::bigint,'idempotent retry preserves show revisions and timestamps');
select ok((select completed_at=(select completed_at from preserved_receipt) from public.migration_receipts where user_id='71000000-0000-0000-0000-000000000001'),'idempotent retry does not update receipt');

set local role authenticated;
insert into migrate_fixture values('conflict',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw2'),'sourceChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'expectedCloudChecksum',repeat('f',64),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value->>'outcome' from migrate_fixture where name='conflict'),'conflict','stale cloud checksum returns conflict');
select is((select value#>>'{conflict,kind}' from migrate_fixture where name='conflict'),'cloud_state','cloud conflict has stable kind');

set local role authenticated;
insert into migrate_fixture values('result2',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw2'),'sourceChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum1'),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value->>'outcome' from migrate_fixture where name='result2'),'success','second exact replacement succeeds');
select is((select title from public.shows where legacy_id='tv-0001'),'Alpha revised','existing show is reconciled by legacy ID');
select is((select revision::text from public.shows where legacy_id='tv-0001'),'2','materially changed show increments revision once');
select is((select count(*) from public.season_progress sp join public.shows s on s.id=sp.show_id where s.legacy_id='tv-0001'),1::bigint,'shortened season list deletes absent season');
select is((select count(*) from public.shows where user_id='71000000-0000-0000-0000-000000000001' and legacy_id='tv-0002'),0::bigint,'show absent from replacement is deleted');
select is((select value#>>'{data,shows,deleted}' from migrate_fixture where name='result2'),'1','deleted show count is reported');
select is((select value#>>'{data,seasons,deleted}' from migrate_fixture where name='result2'),'4','direct and cascaded season deletes are reported');
select is((select source_checksum from public.migration_receipts where user_id='71000000-0000-0000-0000-000000000001'),(select value#>>'{}' from migrate_fixture where name='checksum2'),'receipt is atomically updated to new verified source');

set local role authenticated;
insert into migrate_fixture values('unsupported',public.tracker_migrate_v1('{"migrationKey":"localstorage-tvSeriesTrackerData.v1","mode":"reviewed_merge","sourceSchemaVersion":1,"sourcePayload":{"schemaVersion":1,"shows":[]},"sourceChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","expectedCloudChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mergeDecisions":{"decisions":[]}}'::jsonb));
insert into migrate_fixture values('bad_checksum',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw2'),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
insert into migrate_fixture values('tmdb_conflict',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',jsonb_set((select value from migrate_fixture where name='raw1'),'{shows,0,tmdb,id}','999'::jsonb,true),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
insert into migrate_fixture values('duplicate_legacy',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',jsonb_set((select value from migrate_fixture where name='raw1'),'{shows,1,id}','"tv-0001"'::jsonb),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
insert into migrate_fixture values('duplicate_tmdb',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',jsonb_set((select value from migrate_fixture where name='raw1'),'{shows,1,tmdbId}','101'::jsonb,true),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
insert into migrate_fixture values('backwards_time',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',jsonb_set((select value from migrate_fixture where name='raw2'),'{shows,0,updatedAt}','"2020-01-01T00:00:00Z"'::jsonb),'sourceChecksum',repeat('a',64),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
select is((select value->>'outcome' from migrate_fixture where name='unsupported'),'validation_error','unsupported reviewed merge is rejected safely');
select is((select value#>>'{error,code}' from migrate_fixture where name='bad_checksum'),'source_checksum_mismatch','source checksum mismatch is normalized');
select is((select value#>>'{error,code}' from migrate_fixture where name='tmdb_conflict'),'contradictory_tmdb_alias','contradictory TMDB aliases are rejected before checksum');
select ok(pg_catalog.strpos((select value::text from migrate_fixture where name='tmdb_conflict'),'constraint')=0,'validation response exposes no constraint diagnostic');
select is((select value#>>'{error,code}' from migrate_fixture where name='duplicate_legacy'),'duplicate_identity','duplicate legacy IDs are rejected');
select is((select value#>>'{error,code}' from migrate_fixture where name='duplicate_tmdb'),'duplicate_tmdb_id','duplicate source TMDB IDs are rejected');
select is((select value->>'outcome' from migrate_fixture where name='backwards_time'),'validation_error','updated timestamp before created timestamp is rejected');

create function pg_temp.corrupt_migration_update() returns trigger language plpgsql as $$begin new.title:=new.title||' corrupted'; return new; end$$;
create trigger corrupt_migration_update before update on public.shows for each row execute function pg_temp.corrupt_migration_update();
set local role authenticated;
insert into migrate_fixture values('late_failure',public.tracker_migrate_v1(pg_catalog.jsonb_build_object('migrationKey','localstorage-tvSeriesTrackerData.v1','mode','replace_cloud','sourceSchemaVersion',1,'sourcePayload',(select value from migrate_fixture where name='raw3'),'sourceChecksum',(select value#>>'{}' from migrate_fixture where name='checksum3'),'expectedCloudChecksum',(select value#>>'{}' from migrate_fixture where name='checksum2'),'mergeDecisions','{"decisions":[]}'::jsonb)));
reset role;
drop trigger corrupt_migration_update on public.shows;
select is((select value#>>'{error,code}' from migrate_fixture where name='late_failure'),'verification_failed','late verification failure is normalized safely');
select is((select title from public.shows where legacy_id='tv-0001'),'Alpha revised','late verification failure rolls back show mutation');
select is((select revision::text from public.shows where legacy_id='tv-0001'),'2','late verification failure rolls back revision increment');
select is((select source_checksum from public.migration_receipts where user_id='71000000-0000-0000-0000-000000000001'),(select value#>>'{}' from migrate_fixture where name='checksum2'),'late verification failure rolls back receipt changes');

select * from finish(); rollback;
