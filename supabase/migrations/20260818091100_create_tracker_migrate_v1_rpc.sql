-- Phase 2.4 Step 2: validated v1 exact-replacement migration boundary.

grant tracker_api_owner to postgres;
grant create on schema tracker_private to tracker_api_owner;
grant create on schema public to tracker_api_owner;

create function tracker_private.owner_tracker_payload(owner_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'shows', coalesce(pg_catalog.jsonb_agg(item.show_json order by item.identity collate "C"), '[]'::jsonb)
  )
  from (
    select
      case when s.legacy_id is null then 'cloud:' || pg_catalog.lower(s.id::text) else 'legacy:' || s.legacy_id end as identity,
      pg_catalog.jsonb_build_object(
        'identity', case when s.legacy_id is null then 'cloud:' || pg_catalog.lower(s.id::text) else 'legacy:' || s.legacy_id end,
        'legacyId', s.legacy_id,
        'platform', s.platform,
        'title', s.title,
        'firstAirDate', case when s.first_air_date is null then null else s.first_air_date::text end,
        'synopsis', s.synopsis,
        'posterUrl', s.poster_url,
        'tmdbId', s.tmdb_id,
        'tmdbPosterPath', s.tmdb_poster_path,
        'createdAt', s.created_at,
        'updatedAt', s.updated_at,
        'seasons', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('number', sp.season_number, 'status', sp.status::text)
            order by sp.season_number
          )
          from public.season_progress sp
          where sp.user_id = owner_id and sp.show_id = s.id
        ), '[]'::jsonb)
      ) as show_json
    from public.shows s
    where s.user_id = owner_id
  ) item;
$$;

alter function tracker_private.owner_tracker_payload(uuid) owner to tracker_api_owner;
revoke all on function tracker_private.owner_tracker_payload(uuid) from public, anon, authenticated;
grant execute on function tracker_private.owner_tracker_payload(uuid) to tracker_api_owner;

create function public.tracker_migrate_v1(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mirrors Supabase auth.uid(): the restricted owner intentionally has no
  -- access to the auth schema, so capture the JWT subject once and reuse it.
  caller_claim text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  );
  caller_id uuid;
  unknown_key text;
  shows_source jsonb;
  show_source jsonb;
  season_source jsonb;
  normalized_shows jsonb := '[]'::jsonb;
  normalized_seasons jsonb;
  normalized_payload jsonb;
  source_checksum_value text;
  expected_cloud_checksum_value text;
  computed_source_checksum text;
  current_payload jsonb;
  current_cloud_checksum text;
  result_payload jsonb;
  result_checksum text;
  migration_key_value text;
  legacy_id_value text;
  platform_value text;
  title_value text;
  first_air_date_value date;
  synopsis_value text;
  poster_url_value text;
  created_at_value timestamptz;
  updated_at_value timestamptz;
  tmdb_id_value integer;
  tmdb_poster_path_value text;
  nested_tmdb_id integer;
  alias_tmdb_id integer;
  nested_tmdb_path text;
  alias_tmdb_path text;
  season_number_value integer;
  season_status_value public.season_status;
  show_index integer := 0;
  season_index integer;
  seen_legacy_ids text[] := array[]::text[];
  seen_tmdb_ids integer[] := array[]::integer[];
  seen_seasons integer[];
  precleared_show_ids uuid[] := array[]::uuid[];
  existing_show public.shows%rowtype;
  target_show_id uuid;
  show_was_changed boolean;
  inserted_shows integer := 0;
  updated_shows integer := 0;
  deleted_shows integer := 0;
  unchanged_shows integer := 0;
  inserted_seasons integer := 0;
  updated_seasons integer := 0;
  deleted_seasons integer := 0;
  unchanged_seasons integer := 0;
  final_show_count integer;
  final_season_count integer;
  receipt_completed_at timestamptz;
  existing_receipt public.migration_receipts%rowtype;
  failure_result jsonb;
  correlation_id uuid;
  path_value text;
begin
  begin
    caller_id := caller_claim::uuid;
  exception when invalid_text_representation then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;

  if request is null or pg_catalog.jsonb_typeof(request) <> 'object' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','','code','object_required','message','Request must be a JSON object.')),'correlationId',null));
  end if;
  select key into unknown_key from pg_catalog.jsonb_object_keys(request) key
  where key not in ('migrationKey','mode','sourceSchemaVersion','sourcePayload','sourceChecksum','expectedCloudChecksum','mergeDecisions') order by key limit 1;
  if unknown_key is not null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/'||unknown_key,'code','unknown_field','message','Field is not permitted.')),'correlationId',null));
  end if;

  if pg_catalog.jsonb_typeof(request->'migrationKey') <> 'string' or request->>'migrationKey' is distinct from 'localstorage-tvSeriesTrackerData.v1' then path_value := '/migrationKey';
  elsif pg_catalog.jsonb_typeof(request->'mode') <> 'string' or request->>'mode' is distinct from 'replace_cloud' then path_value := '/mode';
  elsif pg_catalog.jsonb_typeof(request->'sourceSchemaVersion') <> 'number' or request->>'sourceSchemaVersion' <> '1' then path_value := '/sourceSchemaVersion';
  elsif pg_catalog.jsonb_typeof(request->'sourceChecksum') <> 'string' or request->>'sourceChecksum' !~ '^[0-9a-f]{64}$' then path_value := '/sourceChecksum';
  elsif pg_catalog.jsonb_typeof(request->'expectedCloudChecksum') <> 'string' or request->>'expectedCloudChecksum' !~ '^[0-9a-f]{64}$' then path_value := '/expectedCloudChecksum';
  elsif request->'mergeDecisions' is distinct from '{"decisions":[]}'::jsonb then path_value := '/mergeDecisions';
  elsif pg_catalog.jsonb_typeof(request->'sourcePayload') <> 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(request->'sourcePayload')) <> 2
     or pg_catalog.jsonb_typeof(request->'sourcePayload'->'schemaVersion') <> 'number'
     or request->'sourcePayload'->>'schemaVersion' is distinct from '1'
     or pg_catalog.jsonb_typeof(request->'sourcePayload'->'shows') <> 'array' then path_value := '/sourcePayload';
  end if;
  if path_value is not null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',coalesce(request->>'migrationKey',null),'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',path_value,'code','invalid_value','message','Value is not supported or is malformed.')),'correlationId',null));
  end if;

  migration_key_value := request->>'migrationKey';
  source_checksum_value := request->>'sourceChecksum';
  expected_cloud_checksum_value := request->>'expectedCloudChecksum';
  shows_source := request->'sourcePayload'->'shows';

  for show_source in select value from pg_catalog.jsonb_array_elements(shows_source) loop
    path_value := '/sourcePayload/shows/' || show_index::text;
    if pg_catalog.jsonb_typeof(show_source) <> 'object' then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',path_value,'code','object_required','message','Show must be an object.')),'correlationId',null));
    end if;
    select key into unknown_key from pg_catalog.jsonb_object_keys(show_source) key where key not in ('id','platform','title','firstAirDate','description','posterUrl','createdAt','updatedAt','seasons','tmdb','tmdbId','tmdbPosterPath') order by key limit 1;
    if unknown_key is not null then path_value := path_value || '/' || unknown_key; raise sqlstate 'P2001'; end if;

    legacy_id_value := show_source->>'id';
    if pg_catalog.jsonb_typeof(show_source->'id') <> 'string' or legacy_id_value = '' or char_length(legacy_id_value) > 100 then path_value := path_value||'/id'; raise sqlstate 'P2001'; end if;
    if legacy_id_value = any(seen_legacy_ids) then path_value := path_value||'/id'; raise sqlstate 'P2002'; end if;
    seen_legacy_ids := pg_catalog.array_append(seen_legacy_ids,legacy_id_value);
    platform_value := show_source->>'platform'; title_value := show_source->>'title';
    if pg_catalog.jsonb_typeof(show_source->'platform') <> 'string' or char_length(platform_value) not between 1 and 100 or platform_value <> btrim(platform_value) then path_value:=path_value||'/platform'; raise sqlstate 'P2001'; end if;
    if pg_catalog.jsonb_typeof(show_source->'title') <> 'string' or char_length(title_value) not between 1 and 300 or title_value <> btrim(title_value) then path_value:=path_value||'/title'; raise sqlstate 'P2001'; end if;
    first_air_date_value := null;
    if show_source ? 'firstAirDate' and coalesce(show_source->>'firstAirDate','') <> '' then
      if pg_catalog.jsonb_typeof(show_source->'firstAirDate') <> 'string' or show_source->>'firstAirDate' !~ '^\d{4}-\d{2}-\d{2}$' then path_value:=path_value||'/firstAirDate'; raise sqlstate 'P2001'; end if;
      begin first_air_date_value := (show_source->>'firstAirDate')::date; exception when others then path_value:=path_value||'/firstAirDate'; raise sqlstate 'P2001'; end;
    end if;
    synopsis_value := coalesce(show_source->>'description','');
    if (show_source ? 'description' and pg_catalog.jsonb_typeof(show_source->'description') <> 'string') or char_length(synopsis_value)>20000 then path_value:=path_value||'/description'; raise sqlstate 'P2001'; end if;
    poster_url_value := nullif(show_source->>'posterUrl','');
    if show_source ? 'posterUrl' and pg_catalog.jsonb_typeof(show_source->'posterUrl') <> 'string' then path_value:=path_value||'/posterUrl'; raise sqlstate 'P2001'; end if;
    if poster_url_value is not null and (char_length(poster_url_value)>2048 or poster_url_value !~* '^https?://') then path_value:=path_value||'/posterUrl'; raise sqlstate 'P2001'; end if;
    if pg_catalog.jsonb_typeof(show_source->'createdAt') <> 'string' or show_source->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then path_value:=path_value||'/createdAt'; raise sqlstate 'P2001'; end if;
    if pg_catalog.jsonb_typeof(show_source->'updatedAt') <> 'string' or show_source->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then path_value:=path_value||'/updatedAt'; raise sqlstate 'P2001'; end if;
    begin created_at_value := (show_source->>'createdAt')::timestamptz; updated_at_value := (show_source->>'updatedAt')::timestamptz; exception when others then raise sqlstate 'P2001'; end;
    if updated_at_value < created_at_value then path_value:=path_value||'/updatedAt'; raise sqlstate 'P2001'; end if;

    nested_tmdb_id:=null; alias_tmdb_id:=null; nested_tmdb_path:=null; alias_tmdb_path:=null;
    if show_source ? 'tmdb' and show_source->'tmdb' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(show_source->'tmdb') <> 'object' then path_value:=path_value||'/tmdb'; raise sqlstate 'P2001'; end if;
      select key into unknown_key from pg_catalog.jsonb_object_keys(show_source->'tmdb') key where key not in ('id','name','firstAirDate','posterPath') order by key limit 1;
      if unknown_key is not null then path_value:=path_value||'/tmdb/'||unknown_key; raise sqlstate 'P2001'; end if;
      if show_source->'tmdb' ? 'id' and show_source->'tmdb'->'id' <> 'null'::jsonb then if pg_catalog.jsonb_typeof(show_source->'tmdb'->'id')<>'number' or show_source->'tmdb'->>'id' !~ '^[0-9]+$' then path_value:=path_value||'/tmdb/id'; raise sqlstate 'P2001'; end if; begin nested_tmdb_id := (show_source->'tmdb'->>'id')::integer; exception when others then path_value:=path_value||'/tmdb/id'; raise sqlstate 'P2001'; end; if nested_tmdb_id<1 then path_value:=path_value||'/tmdb/id'; raise sqlstate 'P2001'; end if; end if;
      nested_tmdb_path := nullif(show_source->'tmdb'->>'posterPath','');
      if show_source->'tmdb' ? 'name' and show_source->'tmdb'->'name' <> 'null'::jsonb and pg_catalog.jsonb_typeof(show_source->'tmdb'->'name')<>'string' then path_value:=path_value||'/tmdb/name'; raise sqlstate 'P2001'; end if;
      if show_source->'tmdb' ? 'firstAirDate' and coalesce(show_source->'tmdb'->>'firstAirDate','')<>'' then if pg_catalog.jsonb_typeof(show_source->'tmdb'->'firstAirDate')<>'string' or show_source->'tmdb'->>'firstAirDate' !~ '^\d{4}-\d{2}-\d{2}$' then path_value:=path_value||'/tmdb/firstAirDate'; raise sqlstate 'P2001'; end if; begin perform (show_source->'tmdb'->>'firstAirDate')::date; exception when others then path_value:=path_value||'/tmdb/firstAirDate'; raise sqlstate 'P2001'; end; end if;
    end if;
    if show_source ? 'tmdbId' and show_source->'tmdbId'<>'null'::jsonb then if pg_catalog.jsonb_typeof(show_source->'tmdbId')<>'number' or show_source->>'tmdbId' !~ '^[0-9]+$' then path_value:=path_value||'/tmdbId'; raise sqlstate 'P2001'; end if; begin alias_tmdb_id := (show_source->>'tmdbId')::integer; exception when others then path_value:=path_value||'/tmdbId'; raise sqlstate 'P2001'; end; if alias_tmdb_id<1 then path_value:=path_value||'/tmdbId'; raise sqlstate 'P2001'; end if; end if;
    alias_tmdb_path := nullif(show_source->>'tmdbPosterPath','');
    if nested_tmdb_id is not null and alias_tmdb_id is not null and nested_tmdb_id<>alias_tmdb_id then path_value:=path_value||'/tmdbId'; raise sqlstate 'P2003'; end if;
    if nested_tmdb_path is not null and alias_tmdb_path is not null and nested_tmdb_path<>alias_tmdb_path then path_value:=path_value||'/tmdbPosterPath'; raise sqlstate 'P2003'; end if;
    tmdb_id_value:=coalesce(nested_tmdb_id,alias_tmdb_id); tmdb_poster_path_value:=coalesce(nested_tmdb_path,alias_tmdb_path);
    if tmdb_poster_path_value is not null and (char_length(tmdb_poster_path_value)>255 or tmdb_poster_path_value !~ '^/') then path_value:=path_value||'/tmdbPosterPath'; raise sqlstate 'P2001'; end if;
    if tmdb_id_value is not null and tmdb_id_value=any(seen_tmdb_ids) then path_value:=path_value||'/tmdbId'; raise sqlstate 'P2004'; end if;
    if tmdb_id_value is not null then seen_tmdb_ids:=pg_catalog.array_append(seen_tmdb_ids,tmdb_id_value); end if;

    if pg_catalog.jsonb_typeof(show_source->'seasons')<>'array' then path_value:=path_value||'/seasons'; raise sqlstate 'P2001'; end if;
    normalized_seasons:='[]'::jsonb; seen_seasons:=array[]::integer[]; season_index:=0;
    for season_source in select value from pg_catalog.jsonb_array_elements(show_source->'seasons') loop
      if pg_catalog.jsonb_typeof(season_source)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(season_source))<>2 or not season_source ?& array['number','status'] then path_value:=path_value||'/seasons/'||season_index; raise sqlstate 'P2001'; end if;
      begin season_number_value := (season_source->>'number')::integer; exception when others then path_value:=path_value||'/seasons/'||season_index||'/number'; raise sqlstate 'P2001'; end;
      if pg_catalog.jsonb_typeof(season_source->'number')<>'number' or season_source->>'number' !~ '^[0-9]+$' or season_number_value not between 1 and 32767 then path_value:=path_value||'/seasons/'||season_index||'/number'; raise sqlstate 'P2001'; end if;
      if season_number_value=any(seen_seasons) then path_value:=path_value||'/seasons/'||season_index||'/number'; raise sqlstate 'P2002'; end if;
      seen_seasons:=pg_catalog.array_append(seen_seasons,season_number_value);
      season_status_value := (case season_source->>'status' when 'Not Started' then 'not_started' when 'Watching' then 'watching' when 'Completed' then 'completed' when 'Purchase Only' then 'purchase_only' when 'Region Blocked' then 'region_blocked' else null end)::public.season_status;
      if season_status_value is null then path_value:=path_value||'/seasons/'||season_index||'/status'; raise sqlstate 'P2001'; end if;
      normalized_seasons:=normalized_seasons||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('number',season_number_value,'status',season_status_value::text)); season_index:=season_index+1;
    end loop;
    normalized_shows:=normalized_shows||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('identity','legacy:'||legacy_id_value,'legacyId',legacy_id_value,'platform',platform_value,'title',title_value,'firstAirDate',first_air_date_value::text,'synopsis',synopsis_value,'posterUrl',poster_url_value,'tmdbId',tmdb_id_value,'tmdbPosterPath',tmdb_poster_path_value,'createdAt',created_at_value,'updatedAt',updated_at_value,'seasons',normalized_seasons));
    show_index:=show_index+1;
  end loop;

  normalized_payload:=pg_catalog.jsonb_build_object('schemaVersion',2,'shows',normalized_shows);
  computed_source_checksum:=tracker_private.canonical_tracker_sha256(normalized_payload);
  if computed_source_checksum<>source_checksum_value then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','source_checksum_mismatch','message','Source checksum does not match the validated payload.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/sourceChecksum','code','checksum_mismatch','message','Checksum does not match the validated source.')),'correlationId',null));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text,2401));
  current_payload:=tracker_private.owner_tracker_payload(caller_id);
  current_cloud_checksum:=tracker_private.canonical_tracker_sha256(current_payload);
  if current_cloud_checksum<>expected_cloud_checksum_value then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','cloud_state','expectedRevision',null,'currentRevision',null,'currentRecord',null,'expectedCloudChecksum',expected_cloud_checksum_value,'currentCloudChecksum',current_cloud_checksum),'error',null);
  end if;

  select * into existing_receipt from public.migration_receipts where user_id=caller_id and migration_key=migration_key_value;
  if found and existing_receipt.source_checksum=source_checksum_value and existing_receipt.result_checksum=current_cloud_checksum and current_cloud_checksum=source_checksum_value then
    select count(*) into final_show_count from public.shows where user_id=caller_id;
    select count(*) into final_season_count from public.season_progress where user_id=caller_id;
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',pg_catalog.jsonb_build_object('mode','replace_cloud','receipt',pg_catalog.jsonb_build_object('migrationKey',migration_key_value,'sourceSchemaVersion',1),'sourceChecksum',source_checksum_value,'resultChecksum',current_cloud_checksum,'shows',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_show_count),'seasons',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_season_count),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(existing_receipt.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
  end if;

  -- Temporarily free ownership-local TMDB IDs that move between records so
  -- reconciliation does not depend on source order. Final updates still
  -- increment changed retained rows exactly once; absent rows are deleted
  -- after incoming show/season reconciliation.
  for target_show_id in
    select s.id
    from public.shows s
    where s.user_id=caller_id
      and s.tmdb_id is not null
      and (
        exists (
          select 1 from pg_catalog.jsonb_array_elements(normalized_shows) n
          where n->>'legacyId'=s.legacy_id
            and s.tmdb_id is distinct from nullif(n->>'tmdbId','')::integer
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(normalized_shows) n
          where n->>'legacyId' is distinct from s.legacy_id
            and nullif(n->>'tmdbId','')::integer=s.tmdb_id
        )
      )
  loop
    precleared_show_ids:=pg_catalog.array_append(precleared_show_ids,target_show_id);
    update public.shows set tmdb_id=null where id=target_show_id and user_id=caller_id;
  end loop;

  for show_source in select value from pg_catalog.jsonb_array_elements(normalized_shows) loop
    select * into existing_show from public.shows where user_id=caller_id and legacy_id=show_source->>'legacyId';
    if found then
      show_was_changed := existing_show.id=any(precleared_show_ids) or existing_show.platform is distinct from show_source->>'platform' or existing_show.title is distinct from show_source->>'title' or existing_show.first_air_date is distinct from nullif(show_source->>'firstAirDate','')::date or existing_show.synopsis is distinct from show_source->>'synopsis' or existing_show.poster_url is distinct from show_source->>'posterUrl' or existing_show.tmdb_id is distinct from nullif(show_source->>'tmdbId','')::integer or existing_show.tmdb_poster_path is distinct from show_source->>'tmdbPosterPath' or existing_show.created_at is distinct from (show_source->>'createdAt')::timestamptz or existing_show.updated_at is distinct from (show_source->>'updatedAt')::timestamptz;
      target_show_id:=existing_show.id;
      if show_was_changed then
        update public.shows set platform=show_source->>'platform',title=show_source->>'title',first_air_date=nullif(show_source->>'firstAirDate','')::date,synopsis=show_source->>'synopsis',poster_url=show_source->>'posterUrl',tmdb_id=nullif(show_source->>'tmdbId','')::integer,tmdb_poster_path=show_source->>'tmdbPosterPath',created_at=(show_source->>'createdAt')::timestamptz,updated_at=(show_source->>'updatedAt')::timestamptz,revision=revision+1 where id=target_show_id and user_id=caller_id;
        updated_shows:=updated_shows+1;
      else unchanged_shows:=unchanged_shows+1; end if;
    else
      insert into public.shows(user_id,legacy_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision) values(caller_id,show_source->>'legacyId',show_source->>'platform',show_source->>'title',nullif(show_source->>'firstAirDate','')::date,show_source->>'synopsis',show_source->>'posterUrl',nullif(show_source->>'tmdbId','')::integer,show_source->>'tmdbPosterPath',(show_source->>'createdAt')::timestamptz,(show_source->>'updatedAt')::timestamptz,1) returning id into target_show_id;
      inserted_shows:=inserted_shows+1;
    end if;
    normalized_seasons:=show_source->'seasons';
    delete from public.season_progress sp where sp.user_id=caller_id and sp.show_id=target_show_id and not exists(select 1 from pg_catalog.jsonb_array_elements(normalized_seasons) n where (n->>'number')::integer=sp.season_number);
    get diagnostics season_index=row_count; deleted_seasons:=deleted_seasons+season_index;
    for season_source in select value from pg_catalog.jsonb_array_elements(normalized_seasons) loop
      select revision,status into season_index,season_status_value from public.season_progress where user_id=caller_id and show_id=target_show_id and season_number=(season_source->>'number')::integer;
      if found then
        if season_status_value::text is distinct from season_source->>'status' then
          update public.season_progress set status=(season_source->>'status')::public.season_status,updated_at=(show_source->>'updatedAt')::timestamptz,revision=revision+1 where user_id=caller_id and show_id=target_show_id and season_number=(season_source->>'number')::integer;
          updated_seasons:=updated_seasons+1;
        else unchanged_seasons:=unchanged_seasons+1; end if;
      else
        insert into public.season_progress(show_id,user_id,season_number,status,created_at,updated_at,revision) values(target_show_id,caller_id,(season_source->>'number')::integer,(season_source->>'status')::public.season_status,(show_source->>'createdAt')::timestamptz,(show_source->>'updatedAt')::timestamptz,1);
        inserted_seasons:=inserted_seasons+1;
      end if;
    end loop;
  end loop;

  select count(*) into season_index from public.season_progress sp join public.shows s on s.id=sp.show_id and s.user_id=sp.user_id where s.user_id=caller_id and not exists(select 1 from pg_catalog.jsonb_array_elements(normalized_shows) n where n->>'legacyId'=s.legacy_id);
  deleted_seasons:=deleted_seasons+season_index;
  delete from public.shows s where s.user_id=caller_id and not exists(select 1 from pg_catalog.jsonb_array_elements(normalized_shows) n where n->>'legacyId'=s.legacy_id);
  get diagnostics deleted_shows=row_count;

  result_payload:=tracker_private.owner_tracker_payload(caller_id); result_checksum:=tracker_private.canonical_tracker_sha256(result_payload);
  select count(*) into final_show_count from public.shows where user_id=caller_id; select count(*) into final_season_count from public.season_progress where user_id=caller_id;
  if result_checksum<>source_checksum_value then
    failure_result:=pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','verification_failed','message','Migration verification failed and no changes were committed.','fields','[]'::jsonb,'correlationId',null));
    raise sqlstate 'P2005';
  end if;
  receipt_completed_at:=pg_catalog.clock_timestamp();
  insert into public.migration_receipts(user_id,migration_key,source_schema_version,completed_at,source_checksum,result_checksum,imported_show_count,imported_season_count) values(caller_id,migration_key_value,1,receipt_completed_at,source_checksum_value,result_checksum,final_show_count,final_season_count)
  on conflict(user_id,migration_key) do update set source_schema_version=excluded.source_schema_version,completed_at=excluded.completed_at,source_checksum=excluded.source_checksum,result_checksum=excluded.result_checksum,imported_show_count=excluded.imported_show_count,imported_season_count=excluded.imported_season_count;
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',pg_catalog.jsonb_build_object('mode','replace_cloud','receipt',pg_catalog.jsonb_build_object('migrationKey',migration_key_value,'sourceSchemaVersion',1),'sourceChecksum',source_checksum_value,'resultChecksum',result_checksum,'shows',pg_catalog.jsonb_build_object('inserted',inserted_shows,'updated',updated_shows,'deleted',deleted_shows,'unchanged',unchanged_shows),'seasons',pg_catalog.jsonb_build_object('inserted',inserted_seasons,'updated',updated_seasons,'deleted',deleted_seasons,'unchanged',unchanged_seasons),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(receipt_completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
exception
  when sqlstate 'P2001' or sqlstate 'P2002' or sqlstate 'P2003' or sqlstate 'P2004' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code',case sqlstate when 'P2002' then 'duplicate_identity' when 'P2003' then 'contradictory_tmdb_alias' when 'P2004' then 'duplicate_tmdb_id' else 'invalid_input' end,'message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',path_value,'code',case sqlstate when 'P2002' then 'duplicate' when 'P2003' then 'contradiction' when 'P2004' then 'duplicate' else 'invalid_value' end,'message','Value is invalid.')),'correlationId',null));
  when sqlstate 'P2005' then return failure_result;
  when unique_violation then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','One or more fields are invalid.','fields','[]'::jsonb,'correlationId',null));
  when others then
    correlation_id:=pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_migrate_v1(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_migrate_v1(jsonb) from public, anon;
grant execute on function public.tracker_migrate_v1(jsonb) to authenticated;
revoke create on schema tracker_private from tracker_api_owner;
revoke create on schema public from tracker_api_owner;
revoke tracker_api_owner from postgres;
