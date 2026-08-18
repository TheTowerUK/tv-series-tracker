-- Phase 2.3 Step 2: contract-defined query and uniqueness indexes.

create index shows_user_updated_idx
  on public.shows (user_id, updated_at desc);

create index shows_user_platform_idx
  on public.shows (user_id, platform);

create index shows_user_first_air_date_idx
  on public.shows (user_id, first_air_date desc nulls last);

create index shows_user_title_lower_idx
  on public.shows (user_id, lower(title));

create unique index shows_user_tmdb_id_uidx
  on public.shows (user_id, tmdb_id)
  where tmdb_id is not null;

create index season_progress_user_updated_idx
  on public.season_progress (user_id, updated_at desc);

create index migration_receipts_user_completed_idx
  on public.migration_receipts (user_id, completed_at desc);
