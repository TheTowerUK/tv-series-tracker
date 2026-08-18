-- Phase 2.3 Step 1: private tracker domain type and tables.
-- RLS, browser/function-owner grants, RPCs, and additional indexes follow later.

create type public.season_status as enum (
  'not_started',
  'watching',
  'completed',
  'purchase_only',
  'region_blocked'
);

alter type public.season_status owner to postgres;

create table public.shows (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  legacy_id text,
  platform text not null,
  title text not null,
  first_air_date date,
  synopsis text not null default '',
  poster_url text,
  tmdb_id integer,
  tmdb_poster_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,

  constraint shows_pkey primary key (id),
  constraint shows_id_user_id_key unique (id, user_id),
  constraint shows_user_id_legacy_id_key unique (user_id, legacy_id),
  constraint shows_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint shows_platform_length_check
    check (char_length(btrim(platform)) between 1 and 100),
  constraint shows_platform_trimmed_check
    check (platform = btrim(platform)),
  constraint shows_title_length_check
    check (char_length(btrim(title)) between 1 and 300),
  constraint shows_title_trimmed_check
    check (title = btrim(title)),
  constraint shows_synopsis_length_check
    check (char_length(synopsis) <= 20000),
  constraint shows_legacy_id_length_check
    check (legacy_id is null or char_length(legacy_id) between 1 and 100),
  constraint shows_poster_url_check
    check (
      poster_url is null
      or (
        char_length(poster_url) <= 2048
        and poster_url ~* '^https?://'
      )
    ),
  constraint shows_tmdb_id_check
    check (tmdb_id is null or tmdb_id > 0),
  constraint shows_tmdb_poster_path_check
    check (
      tmdb_poster_path is null
      or (
        char_length(tmdb_poster_path) <= 255
        and tmdb_poster_path ~ '^/'
      )
    ),
  constraint shows_revision_check
    check (revision >= 1)
);

alter table public.shows owner to postgres;

create table public.season_progress (
  id uuid not null default gen_random_uuid(),
  show_id uuid not null,
  user_id uuid not null default auth.uid(),
  season_number smallint not null,
  status public.season_status not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1,

  constraint season_progress_pkey primary key (id),
  constraint season_progress_show_id_season_number_key
    unique (show_id, season_number),
  constraint season_progress_show_id_user_id_fkey
    foreign key (show_id, user_id)
    references public.shows (id, user_id)
    on delete cascade,
  constraint season_progress_season_number_check
    check (season_number between 1 and 32767),
  constraint season_progress_revision_check
    check (revision >= 1)
);

alter table public.season_progress owner to postgres;

create table public.migration_receipts (
  user_id uuid not null,
  migration_key text not null,
  source_schema_version integer not null,
  completed_at timestamptz not null default now(),
  source_checksum text not null,
  result_checksum text not null,
  imported_show_count integer,
  imported_season_count integer,

  constraint migration_receipts_pkey primary key (user_id, migration_key),
  constraint migration_receipts_user_id_fkey
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  constraint migration_receipts_migration_key_check
    check (
      migration_key = btrim(migration_key)
      and char_length(migration_key) between 1 and 100
    ),
  constraint migration_receipts_source_schema_version_check
    check (source_schema_version > 0),
  constraint migration_receipts_source_checksum_check
    check (source_checksum ~ '^[0-9a-f]{64}$'),
  constraint migration_receipts_result_checksum_check
    check (result_checksum ~ '^[0-9a-f]{64}$'),
  constraint migration_receipts_imported_show_count_check
    check (imported_show_count is null or imported_show_count >= 0),
  constraint migration_receipts_imported_season_count_check
    check (imported_season_count is null or imported_season_count >= 0)
);

alter table public.migration_receipts owner to postgres;
