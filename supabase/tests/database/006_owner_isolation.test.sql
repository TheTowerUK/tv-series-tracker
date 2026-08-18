begin;

select plan(10);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'phase23-user-a@example.invalid'),
  ('20000000-0000-0000-0000-000000000002', 'phase23-user-b@example.invalid');

insert into public.shows (id, user_id, platform, title)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Platform A', 'Owner A Show'),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Platform B', 'Owner B Show');

insert into public.season_progress (id, show_id, user_id, season_number, status)
values
  ('11100000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'watching'),
  ('22200000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 1, 'completed');

insert into public.migration_receipts (
  user_id,
  migration_key,
  source_schema_version,
  source_checksum,
  result_checksum
)
values
  ('10000000-0000-0000-0000-000000000001', 'test-a', 1, repeat('a', 64), repeat('a', 64)),
  ('20000000-0000-0000-0000-000000000002', 'test-b', 1, repeat('b', 64), repeat('b', 64));

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*)::bigint from public.shows), 1::bigint, 'authenticated user A sees only their show');
select is((select count(*)::bigint from public.season_progress), 1::bigint, 'authenticated user A sees only their season');
select is((select count(*)::bigint from public.migration_receipts), 1::bigint, 'authenticated user A sees only their receipt');
reset role;

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::bigint from public.shows), 1::bigint, 'authenticated user B sees only their show');
select is((select count(*)::bigint from public.season_progress), 1::bigint, 'authenticated user B sees only their season');
select is((select count(*)::bigint from public.migration_receipts), 1::bigint, 'authenticated user B sees only their receipt');
reset role;

-- The test runner is not a member of the deliberately NOLOGIN function-owner
-- role. This membership exists only inside the rolled-back test transaction.
grant tracker_api_owner to postgres;
create temporary table api_owner_observations (
  observation text primary key,
  observed_count bigint not null
);
grant insert, select on api_owner_observations to tracker_api_owner;

select pg_catalog.set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role tracker_api_owner;
insert into api_owner_observations
select 'visible_shows', count(*)::bigint from public.shows;
with changed as (
  update public.shows
  set title = 'Cross-owner change'
  where id = '22000000-0000-0000-0000-000000000002'
  returning 1
)
insert into api_owner_observations
select 'cross_owner_show_updates', count(*)::bigint from changed;
with removed as (
  delete from public.season_progress
  where id = '22200000-0000-0000-0000-000000000002'
  returning 1
)
insert into api_owner_observations
select 'cross_owner_season_deletes', count(*)::bigint from removed;
reset role;

select is(
  (select observed_count from api_owner_observations where observation = 'visible_shows'),
  1::bigint,
  'tracker_api_owner is restricted to caller-owned shows'
);
select is(
  (select observed_count from api_owner_observations where observation = 'cross_owner_show_updates'),
  0::bigint,
  'tracker_api_owner cannot update another owner show'
);
select is(
  (select observed_count from api_owner_observations where observation = 'cross_owner_season_deletes'),
  0::bigint,
  'tracker_api_owner cannot delete another owner season'
);

select throws_ok(
  $$
    insert into public.season_progress (show_id, user_id, season_number)
    values (
      '11000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      2
    )
  $$,
  '23503',
  'insert or update on table "season_progress" violates foreign key constraint "season_progress_show_id_user_id_fkey"',
  'composite owner foreign key rejects a mismatched show owner'
);

select * from finish();
rollback;
