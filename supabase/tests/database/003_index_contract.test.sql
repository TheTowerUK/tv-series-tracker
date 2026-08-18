begin;

select plan(15);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname in (
        'shows_user_updated_idx',
        'shows_user_platform_idx',
        'shows_user_first_air_date_idx',
        'shows_user_title_lower_idx',
        'shows_user_tmdb_id_uidx',
        'season_progress_user_updated_idx',
        'migration_receipts_user_completed_idx'
      )
  ),
  7,
  'all seven contract-defined indexes exist'
);

select has_index('public', 'shows', 'shows_user_updated_idx', 'shows owner/update index exists');
select has_index('public', 'shows', 'shows_user_platform_idx', 'shows owner/platform index exists');
select has_index('public', 'shows', 'shows_user_first_air_date_idx', 'shows owner/air-date index exists');
select has_index('public', 'shows', 'shows_user_title_lower_idx', 'shows owner/lower-title index exists');
select has_index('public', 'shows', 'shows_user_tmdb_id_uidx', 'shows owner/TMDB unique index exists');
select has_index('public', 'season_progress', 'season_progress_user_updated_idx', 'season owner/update index exists');
select has_index('public', 'migration_receipts', 'migration_receipts_user_completed_idx', 'receipt owner/completion index exists');

select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.shows_user_updated_idx'::pg_catalog.regclass), 'CREATE INDEX shows_user_updated_idx ON public.shows USING btree (user_id, updated_at DESC)', 'shows owner/update index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.shows_user_platform_idx'::pg_catalog.regclass), 'CREATE INDEX shows_user_platform_idx ON public.shows USING btree (user_id, platform)', 'shows owner/platform index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.shows_user_first_air_date_idx'::pg_catalog.regclass), 'CREATE INDEX shows_user_first_air_date_idx ON public.shows USING btree (user_id, first_air_date DESC NULLS LAST)', 'shows owner/air-date index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.shows_user_title_lower_idx'::pg_catalog.regclass), 'CREATE INDEX shows_user_title_lower_idx ON public.shows USING btree (user_id, lower(title))', 'shows owner/lower-title index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.shows_user_tmdb_id_uidx'::pg_catalog.regclass), 'CREATE UNIQUE INDEX shows_user_tmdb_id_uidx ON public.shows USING btree (user_id, tmdb_id) WHERE (tmdb_id IS NOT NULL)', 'shows owner/TMDB partial unique index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.season_progress_user_updated_idx'::pg_catalog.regclass), 'CREATE INDEX season_progress_user_updated_idx ON public.season_progress USING btree (user_id, updated_at DESC)', 'season owner/update index definition matches');
select is((select pg_catalog.pg_get_indexdef(indexrelid) from pg_catalog.pg_index where indexrelid = 'public.migration_receipts_user_completed_idx'::pg_catalog.regclass), 'CREATE INDEX migration_receipts_user_completed_idx ON public.migration_receipts USING btree (user_id, completed_at DESC)', 'receipt owner/completion index definition matches');

select * from finish();
rollback;
