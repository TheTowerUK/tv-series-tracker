begin;

select plan(52);

select has_type('public', 'season_status', 'season_status enum exists');
select is(
  (
    select pg_catalog.array_agg(enumlabel order by enumsortorder)::text
    from pg_catalog.pg_enum
    where enumtypid = 'public.season_status'::pg_catalog.regtype
  ),
  '{not_started,watching,completed,purchase_only,region_blocked}',
  'season_status has the five contract values in order'
);

select has_table('public', 'shows', 'shows table exists');
select has_table('public', 'season_progress', 'season_progress table exists');
select has_table('public', 'migration_receipts', 'migration_receipts table exists');

select is(
  (
    select pg_catalog.string_agg(
      column_name || ':' ||
      case
        when data_type = 'USER-DEFINED' then udt_schema || '.' || udt_name
        else data_type
      end || ':' || is_nullable || ':' ||
      case when column_default is null then 'none' else 'default' end,
      ',' order by ordinal_position
    )
    from information_schema.columns
    where table_schema = 'public' and table_name = 'shows'
  ),
  'id:uuid:NO:default,user_id:uuid:NO:default,legacy_id:text:YES:none,platform:text:NO:none,title:text:NO:none,first_air_date:date:YES:none,synopsis:text:NO:default,poster_url:text:YES:none,tmdb_id:integer:YES:none,tmdb_poster_path:text:YES:none,created_at:timestamp with time zone:NO:default,updated_at:timestamp with time zone:NO:default,revision:bigint:NO:default',
  'shows columns, types, nullability, and default presence match the contract'
);

select is(
  (
    select pg_catalog.string_agg(
      column_name || ':' ||
      case
        when data_type = 'USER-DEFINED' then udt_schema || '.' || udt_name
        else data_type
      end || ':' || is_nullable || ':' ||
      case when column_default is null then 'none' else 'default' end,
      ',' order by ordinal_position
    )
    from information_schema.columns
    where table_schema = 'public' and table_name = 'season_progress'
  ),
  'id:uuid:NO:default,show_id:uuid:NO:none,user_id:uuid:NO:default,season_number:smallint:NO:none,status:public.season_status:NO:default,created_at:timestamp with time zone:NO:default,updated_at:timestamp with time zone:NO:default,revision:bigint:NO:default',
  'season_progress columns, types, nullability, and default presence match the contract'
);

select is(
  (
    select pg_catalog.string_agg(
      column_name || ':' || data_type || ':' || is_nullable || ':' ||
      case when column_default is null then 'none' else 'default' end,
      ',' order by ordinal_position
    )
    from information_schema.columns
    where table_schema = 'public' and table_name = 'migration_receipts'
  ),
  'user_id:uuid:NO:none,migration_key:text:NO:none,source_schema_version:integer:NO:none,completed_at:timestamp with time zone:NO:default,source_checksum:text:NO:none,result_checksum:text:NO:none,imported_show_count:integer:YES:none,imported_season_count:integer:YES:none',
  'migration_receipts columns, types, nullability, and default presence match the contract'
);

select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'gen_random_uuid'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'id'),
  'shows.id is server-generated'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'auth.uid'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'user_id'),
  'shows.user_id defaults from auth.uid()'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) in (
     pg_catalog.quote_literal(''),
     pg_catalog.quote_literal('') || '::text'
   )
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'synopsis'),
  'shows.synopsis defaults to empty text'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'now\(\)'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'created_at'),
  'shows.created_at uses server time'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'now\(\)'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'updated_at'),
  'shows.updated_at uses server time'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ '^1(::bigint)?$'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.shows'::pg_catalog.regclass and a.attname = 'revision'),
  'shows.revision defaults to one'
);

select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'gen_random_uuid'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'id'),
  'season_progress.id is server-generated'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'auth.uid'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'user_id'),
  'season_progress.user_id defaults from auth.uid()'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'not_started'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'status'),
  'season_progress.status defaults to not_started'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'now\(\)'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'created_at'),
  'season_progress.created_at uses server time'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'now\(\)'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'updated_at'),
  'season_progress.updated_at uses server time'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ '^1(::bigint)?$'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.season_progress'::pg_catalog.regclass and a.attname = 'revision'),
  'season_progress.revision defaults to one'
);
select ok(
  (select pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~ 'now\(\)'
   from pg_catalog.pg_attrdef d
   join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.migration_receipts'::pg_catalog.regclass and a.attname = 'completed_at'),
  'migration_receipts.completed_at uses server time'
);

select has_pk('public', 'shows', 'shows has a primary key');
select has_pk('public', 'season_progress', 'season_progress has a primary key');
select has_pk('public', 'migration_receipts', 'migration_receipts has a primary key');

select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_id_user_id_key' and contype = 'u'),
  'shows has its composite owner identity uniqueness constraint'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_user_id_legacy_id_key' and contype = 'u'),
  'shows has per-owner legacy identity uniqueness'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.season_progress'::pg_catalog.regclass and conname = 'season_progress_show_id_season_number_key' and contype = 'u'),
  'season_progress has one row per show and season number'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_user_id_fkey' and contype = 'f' and confrelid = 'auth.users'::pg_catalog.regclass and confdeltype = 'c'),
  'shows owner foreign key cascades on Auth-user deletion'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.season_progress'::pg_catalog.regclass and conname = 'season_progress_show_id_user_id_fkey' and contype = 'f' and confrelid = 'public.shows'::pg_catalog.regclass and confdeltype = 'c'),
  'season_progress composite owner foreign key cascades on show deletion'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_user_id_fkey' and contype = 'f' and confrelid = 'auth.users'::pg_catalog.regclass and confdeltype = 'c'),
  'migration receipt owner foreign key cascades on Auth-user deletion'
);

select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_platform_length_check' and contype = 'c'), 'platform length check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_platform_trimmed_check' and contype = 'c'), 'platform trim check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_title_length_check' and contype = 'c'), 'title length check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_title_trimmed_check' and contype = 'c'), 'title trim check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_synopsis_length_check' and contype = 'c'), 'synopsis length check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_legacy_id_length_check' and contype = 'c'), 'legacy ID length check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_poster_url_check' and contype = 'c'), 'poster URL check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_tmdb_id_check' and contype = 'c'), 'TMDB ID check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_tmdb_poster_path_check' and contype = 'c'), 'TMDB poster path check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.shows'::pg_catalog.regclass and conname = 'shows_revision_check' and contype = 'c'), 'show revision check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.season_progress'::pg_catalog.regclass and conname = 'season_progress_season_number_check' and contype = 'c'), 'season number range check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.season_progress'::pg_catalog.regclass and conname = 'season_progress_revision_check' and contype = 'c'), 'season revision check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_migration_key_check' and contype = 'c'), 'migration key check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_source_schema_version_check' and contype = 'c'), 'source schema version check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_source_checksum_check' and contype = 'c'), 'source checksum check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_result_checksum_check' and contype = 'c'), 'result checksum check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_imported_show_count_check' and contype = 'c'), 'imported show count check exists');
select ok(exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.migration_receipts'::pg_catalog.regclass and conname = 'migration_receipts_imported_season_count_check' and contype = 'c'), 'imported season count check exists');

select is((select typowner::pg_catalog.regrole::text from pg_catalog.pg_type where oid = 'public.season_status'::pg_catalog.regtype), 'postgres', 'postgres owns season_status');
select is((select relowner::pg_catalog.regrole::text from pg_catalog.pg_class where oid = 'public.shows'::pg_catalog.regclass), 'postgres', 'postgres owns shows');
select is((select relowner::pg_catalog.regrole::text from pg_catalog.pg_class where oid = 'public.season_progress'::pg_catalog.regclass), 'postgres', 'postgres owns season_progress');
select is((select relowner::pg_catalog.regrole::text from pg_catalog.pg_class where oid = 'public.migration_receipts'::pg_catalog.regclass), 'postgres', 'postgres owns migration_receipts');

select * from finish();
rollback;
