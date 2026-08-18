begin;

select plan(9);

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.shows'::pg_catalog.regclass), 'shows has RLS enabled');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.shows'::pg_catalog.regclass), 'shows has RLS forced');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.season_progress'::pg_catalog.regclass), 'season_progress has RLS enabled');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.season_progress'::pg_catalog.regclass), 'season_progress has RLS forced');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.migration_receipts'::pg_catalog.regclass), 'migration_receipts has RLS enabled');
select ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.migration_receipts'::pg_catalog.regclass), 'migration_receipts has RLS forced');

select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename in ('shows', 'season_progress', 'migration_receipts')),
  12,
  'exactly twelve tracker policies exist'
);

select is(
  (
    select pg_catalog.string_agg(
      tablename || ':' || policyname || ':' || cmd || ':' || roles::text,
      ',' order by tablename, policyname
    )
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('shows', 'season_progress', 'migration_receipts')
  ),
  'migration_receipts:migration_receipts_authenticated_select:SELECT:{authenticated},migration_receipts:migration_receipts_tracker_api_select:SELECT:{tracker_api_owner},season_progress:season_progress_authenticated_select:SELECT:{authenticated},season_progress:season_progress_tracker_api_delete:DELETE:{tracker_api_owner},season_progress:season_progress_tracker_api_insert:INSERT:{tracker_api_owner},season_progress:season_progress_tracker_api_select:SELECT:{tracker_api_owner},season_progress:season_progress_tracker_api_update:UPDATE:{tracker_api_owner},shows:shows_authenticated_select:SELECT:{authenticated},shows:shows_tracker_api_delete:DELETE:{tracker_api_owner},shows:shows_tracker_api_insert:INSERT:{tracker_api_owner},shows:shows_tracker_api_select:SELECT:{tracker_api_owner},shows:shows_tracker_api_update:UPDATE:{tracker_api_owner}',
  'policy names, tables, commands, and target roles match exactly'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'migration_receipts'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ),
  0,
  'migration_receipts has no mutation policy'
);

select * from finish();
rollback;
