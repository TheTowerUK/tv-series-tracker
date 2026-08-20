-- Phase 2.4 Step 4: validated v2 exact replacement and reviewed restore.

grant tracker_api_owner to postgres;
grant create on schema public to tracker_api_owner;

create function public.tracker_restore_v2(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mirrors Supabase auth.uid(): tracker_api_owner intentionally has no auth
  -- schema access, so capture the JWT subject once and reuse that UUID.
  caller_claim text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  );
  caller_id uuid;
  mode_value text;
  source_checksum_value text;
  expected_cloud_checksum_value text;
  computed_source_checksum text;
  current_checksum text;
  result_checksum text;
  current_payload jsonb;
  source_payload jsonb;
  shows_source jsonb;
  show_source jsonb;
  season_source jsonb;
  decisions jsonb;
  decision jsonb;
  other_decision jsonb;
  unknown_key text;
  path_value text;
  identity_value text;
  legacy_id_value text;
  source_identity text;
  cloud_identity text;
  entity_type_value text;
  action_value text;
  target_key text;
  target_show_id uuid;
  target_season_number integer;
  source_season_number integer;
  source_show jsonb;
  source_season jsonb;
  existing_show public.shows%rowtype;
  existing_season public.season_progress%rowtype;
  current_revision_value bigint;
  created_at_value timestamptz;
  updated_at_value timestamptz;
  exported_at_value timestamptz;
  tmdb_id_value integer;
  season_number_value integer;
  show_index integer := 0;
  season_index integer;
  seen_identities text[] := array[]::text[];
  seen_legacy_ids text[] := array[]::text[];
  seen_tmdb_ids integer[] := array[]::integer[];
  seen_seasons integer[];
  seen_targets text[] := array[]::text[];
  created_sources text[] := array[]::text[];
  created_ids uuid[] := array[]::uuid[];
  changed_value boolean;
  removed_count integer;
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
  completed_at_value timestamptz;
  correlation_id uuid;
begin
  begin
    caller_id := caller_claim::uuid;
  exception when invalid_text_representation then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_restore_v2','entity','restore','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_restore_v2','entity','restore','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;

  if request is null or pg_catalog.jsonb_typeof(request) <> 'object' then
    path_value := '';
    raise sqlstate 'P2501';
  end if;
  select key into unknown_key from pg_catalog.jsonb_object_keys(request) key
  where key not in ('mode','sourceSchemaVersion','sourcePayload','sourceChecksum','expectedCloudChecksum','mergeDecisions')
  order by key collate "C" limit 1;
  if unknown_key is not null then path_value := '/' || unknown_key; raise sqlstate 'P2502'; end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(request)) <> 6 then path_value := ''; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'mode') <> 'string' or request->>'mode' not in ('replace_cloud','reviewed_merge') then path_value := '/mode'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourceSchemaVersion') <> 'number' or request->>'sourceSchemaVersion' <> '2' then path_value := '/sourceSchemaVersion'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourceChecksum') <> 'string' or request->>'sourceChecksum' !~ '^[0-9a-f]{64}$' then path_value := '/sourceChecksum'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'expectedCloudChecksum') <> 'string' or request->>'expectedCloudChecksum' !~ '^[0-9a-f]{64}$' then path_value := '/expectedCloudChecksum'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourcePayload') <> 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(request->'sourcePayload')) <> 4
     or not request->'sourcePayload' ?& array['schemaVersion','contractVersion','exportedAt','shows'] then path_value := '/sourcePayload'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourcePayload'->'schemaVersion') <> 'number' or request->'sourcePayload'->>'schemaVersion' <> '2' then path_value := '/sourcePayload/schemaVersion'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourcePayload'->'contractVersion') <> 'string' or request->'sourcePayload'->>'contractVersion' <> '2.0.0' then path_value := '/sourcePayload/contractVersion'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourcePayload'->'exportedAt') <> 'string' or request->'sourcePayload'->>'exportedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then path_value := '/sourcePayload/exportedAt'; raise sqlstate 'P2501'; end if;
  begin exported_at_value := (request->'sourcePayload'->>'exportedAt')::timestamptz; exception when others then path_value := '/sourcePayload/exportedAt'; raise sqlstate 'P2501'; end;
  if pg_catalog.to_char(exported_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> request->'sourcePayload'->>'exportedAt' then path_value := '/sourcePayload/exportedAt'; raise sqlstate 'P2501'; end if;
  if pg_catalog.jsonb_typeof(request->'sourcePayload'->'shows') <> 'array' then path_value := '/sourcePayload/shows'; raise sqlstate 'P2501'; end if;

  mode_value := request->>'mode';
  source_checksum_value := request->>'sourceChecksum';
  expected_cloud_checksum_value := request->>'expectedCloudChecksum';
  source_payload := request->'sourcePayload';
  shows_source := source_payload->'shows';
  decisions := request->'mergeDecisions';
  if pg_catalog.jsonb_typeof(decisions) <> 'object' or (select count(*) from pg_catalog.jsonb_object_keys(decisions)) <> 1 or pg_catalog.jsonb_typeof(decisions->'decisions') <> 'array' then path_value := '/mergeDecisions'; raise sqlstate 'P2501'; end if;
  if mode_value='replace_cloud' and decisions is distinct from '{"decisions":[]}'::jsonb then path_value := '/mergeDecisions'; raise sqlstate 'P2501'; end if;

  for show_source in select value from pg_catalog.jsonb_array_elements(shows_source) loop
    path_value := '/sourcePayload/shows/' || show_index::text;
    if pg_catalog.jsonb_typeof(show_source) <> 'object'
       or (select count(*) from pg_catalog.jsonb_object_keys(show_source)) <> 12
       or not show_source ?& array['identity','legacyId','platform','title','firstAirDate','synopsis','posterUrl','tmdbId','tmdbPosterPath','createdAt','updatedAt','seasons'] then raise sqlstate 'P2501'; end if;
    if pg_catalog.jsonb_typeof(show_source->'identity') <> 'string' then path_value := path_value || '/identity'; raise sqlstate 'P2501'; end if;
    identity_value := show_source->>'identity';
    if identity_value !~ '^(cloud:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|legacy:.+)$' then path_value := path_value || '/identity'; raise sqlstate 'P2501'; end if;
    if identity_value = any(seen_identities) then path_value := path_value || '/identity'; raise sqlstate 'P2503'; end if;
    seen_identities := pg_catalog.array_append(seen_identities,identity_value);
    if show_source->'legacyId' <> 'null'::jsonb then
      if pg_catalog.jsonb_typeof(show_source->'legacyId') <> 'string' or char_length(show_source->>'legacyId') not between 1 and 100 or show_source->>'legacyId' <> btrim(show_source->>'legacyId') then path_value := path_value || '/legacyId'; raise sqlstate 'P2501'; end if;
      legacy_id_value := show_source->>'legacyId';
      if identity_value <> 'legacy:' || legacy_id_value then path_value := path_value || '/identity'; raise sqlstate 'P2501'; end if;
      if legacy_id_value = any(seen_legacy_ids) then path_value := path_value || '/legacyId'; raise sqlstate 'P2503'; end if;
      seen_legacy_ids := pg_catalog.array_append(seen_legacy_ids,legacy_id_value);
    else
      legacy_id_value := null;
      if identity_value !~ '^cloud:' then path_value := path_value || '/identity'; raise sqlstate 'P2501'; end if;
    end if;
    if pg_catalog.jsonb_typeof(show_source->'platform') <> 'string' or char_length(btrim(show_source->>'platform')) not between 1 and 100 or show_source->>'platform' <> btrim(show_source->>'platform') then path_value := path_value || '/platform'; raise sqlstate 'P2501'; end if;
    if pg_catalog.jsonb_typeof(show_source->'title') <> 'string' or char_length(btrim(show_source->>'title')) not between 1 and 300 or show_source->>'title' <> btrim(show_source->>'title') then path_value := path_value || '/title'; raise sqlstate 'P2501'; end if;
    if show_source->'firstAirDate' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(show_source->'firstAirDate') <> 'string' or show_source->>'firstAirDate' !~ '^\d{4}-\d{2}-\d{2}$') then path_value := path_value || '/firstAirDate'; raise sqlstate 'P2501'; end if;
    begin perform (show_source->>'firstAirDate')::date where show_source->'firstAirDate'<>'null'::jsonb; exception when others then path_value := path_value || '/firstAirDate'; raise sqlstate 'P2501'; end;
    if pg_catalog.jsonb_typeof(show_source->'synopsis') <> 'string' or char_length(show_source->>'synopsis') > 20000 then path_value := path_value || '/synopsis'; raise sqlstate 'P2501'; end if;
    if show_source->'posterUrl'<>'null'::jsonb and (pg_catalog.jsonb_typeof(show_source->'posterUrl')<>'string' or char_length(show_source->>'posterUrl')>2048 or show_source->>'posterUrl' !~* '^https?://') then path_value := path_value || '/posterUrl'; raise sqlstate 'P2501'; end if;
    if show_source->'tmdbId'<>'null'::jsonb then
      if pg_catalog.jsonb_typeof(show_source->'tmdbId')<>'number' or show_source->>'tmdbId' !~ '^[1-9][0-9]*$' then path_value := path_value || '/tmdbId'; raise sqlstate 'P2501'; end if;
      begin tmdb_id_value := (show_source->>'tmdbId')::integer; exception when others then path_value := path_value || '/tmdbId'; raise sqlstate 'P2501'; end;
      if tmdb_id_value=any(seen_tmdb_ids) then path_value := path_value || '/tmdbId'; raise sqlstate 'P2504'; end if;
      seen_tmdb_ids := pg_catalog.array_append(seen_tmdb_ids,tmdb_id_value);
    end if;
    if show_source->'tmdbPosterPath'<>'null'::jsonb and (pg_catalog.jsonb_typeof(show_source->'tmdbPosterPath')<>'string' or char_length(show_source->>'tmdbPosterPath')>255 or show_source->>'tmdbPosterPath' !~ '^/') then path_value := path_value || '/tmdbPosterPath'; raise sqlstate 'P2501'; end if;
    if pg_catalog.jsonb_typeof(show_source->'createdAt')<>'string' or show_source->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then path_value := path_value || '/createdAt'; raise sqlstate 'P2501'; end if;
    if pg_catalog.jsonb_typeof(show_source->'updatedAt')<>'string' or show_source->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then path_value := path_value || '/updatedAt'; raise sqlstate 'P2501'; end if;
    begin created_at_value := (show_source->>'createdAt')::timestamptz; updated_at_value := (show_source->>'updatedAt')::timestamptz; exception when others then raise sqlstate 'P2501'; end;
    if updated_at_value<created_at_value then path_value := path_value || '/updatedAt'; raise sqlstate 'P2501'; end if;
    if pg_catalog.to_char(created_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>show_source->>'createdAt' then path_value := path_value || '/createdAt'; raise sqlstate 'P2501'; end if;
    if pg_catalog.to_char(updated_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>show_source->>'updatedAt' then path_value := path_value || '/updatedAt'; raise sqlstate 'P2501'; end if;
    if pg_catalog.jsonb_typeof(show_source->'seasons')<>'array' then path_value := path_value || '/seasons'; raise sqlstate 'P2501'; end if;
    seen_seasons := array[]::integer[]; season_index := 0;
    for season_source in select value from pg_catalog.jsonb_array_elements(show_source->'seasons') loop
      path_value := '/sourcePayload/shows/'||show_index||'/seasons/'||season_index;
      if pg_catalog.jsonb_typeof(season_source)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(season_source))<>2 or not season_source ?& array['number','status'] then raise sqlstate 'P2501'; end if;
      if pg_catalog.jsonb_typeof(season_source->'number')<>'number' or season_source->>'number' !~ '^[1-9][0-9]*$' then path_value := path_value || '/number'; raise sqlstate 'P2501'; end if;
      begin season_number_value := (season_source->>'number')::integer; exception when others then path_value := path_value || '/number'; raise sqlstate 'P2501'; end;
      if season_number_value not between 1 and 32767 then path_value := path_value || '/number'; raise sqlstate 'P2501'; end if;
      if season_number_value=any(seen_seasons) then path_value := path_value || '/number'; raise sqlstate 'P2503'; end if;
      seen_seasons := pg_catalog.array_append(seen_seasons,season_number_value);
      if pg_catalog.jsonb_typeof(season_source->'status')<>'string' or season_source->>'status' not in ('not_started','watching','completed','purchase_only','region_blocked') then path_value := path_value || '/status'; raise sqlstate 'P2501'; end if;
      season_index := season_index+1;
    end loop;
    show_index := show_index+1;
  end loop;

  begin computed_source_checksum := tracker_private.canonical_tracker_sha256(source_payload); exception when others then path_value := '/sourcePayload'; raise sqlstate 'P2501'; end;
  if computed_source_checksum<>source_checksum_value then path_value := '/sourceChecksum'; raise sqlstate 'P2505'; end if;

  decisions := decisions->'decisions';
  if mode_value='reviewed_merge' then
    show_index:=0;
    for decision in select value from pg_catalog.jsonb_array_elements(decisions) loop
      path_value := '/mergeDecisions/decisions/'||show_index;
      if pg_catalog.jsonb_typeof(decision)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(decision))<>5 or not decision ?& array['entityType','sourceIdentity','cloudIdentity','action','expectedRevision'] then raise sqlstate 'P2501'; end if;
      entity_type_value:=decision->>'entityType'; source_identity:=decision->>'sourceIdentity'; cloud_identity:=decision->>'cloudIdentity'; action_value:=decision->>'action';
      if entity_type_value='show' and action_value not in ('keep_cloud_record','apply_local_record','create_local_record','delete_cloud_record') then raise sqlstate 'P2501'; end if;
      if entity_type_value='season' and action_value not in ('keep_cloud_season','apply_local_season','create_local_season','delete_cloud_season') then raise sqlstate 'P2501'; end if;
      if entity_type_value not in ('show','season') then raise sqlstate 'P2501'; end if;
      if action_value like 'keep_%' then
        if cloud_identity is null or decision->'expectedRevision'<>'null'::jsonb then raise sqlstate 'P2501'; end if;
      elsif action_value like 'create_%' then
        if source_identity is null or decision->'cloudIdentity'<>'null'::jsonb or decision->'expectedRevision'<>'null'::jsonb then raise sqlstate 'P2501'; end if;
      else
        if cloud_identity is null or decision->'expectedRevision'='null'::jsonb or pg_catalog.jsonb_typeof(decision->'expectedRevision')<>'string' or decision->>'expectedRevision' !~ '^[1-9][0-9]{0,18}$' then raise sqlstate 'P2501'; end if;
        begin perform (decision->>'expectedRevision')::bigint; exception when others then raise sqlstate 'P2501'; end;
        if action_value like 'apply_%' and source_identity is null then raise sqlstate 'P2501'; end if;
      end if;
      if source_identity is not null and ((entity_type_value='show' and not source_identity=any(seen_identities)) or (entity_type_value='season' and source_identity !~ '^.+/season:[1-9][0-9]*$')) then raise sqlstate 'P2501'; end if;
      if cloud_identity is not null and ((entity_type_value='show' and cloud_identity !~ '^show:[0-9a-f-]{36}$') or (entity_type_value='season' and cloud_identity !~ '^show:[0-9a-f-]{36}/season:[1-9][0-9]*$')) then raise sqlstate 'P2501'; end if;
      if action_value like 'apply_%' and source_identity like 'cloud:%'
         and substring(split_part(source_identity,'/season:',1) from 7) <> split_part(split_part(cloud_identity,'show:',2),'/season:',1) then raise sqlstate 'P2501'; end if;
      target_key:=coalesce(cloud_identity,'source:'||source_identity);
      if target_key=any(seen_targets) then raise sqlstate 'P2506'; end if;
      seen_targets:=pg_catalog.array_append(seen_targets,target_key); show_index:=show_index+1;
    end loop;
    for decision in select value from pg_catalog.jsonb_array_elements(decisions) where value->>'action'='delete_cloud_record' loop
      for other_decision in select value from pg_catalog.jsonb_array_elements(decisions) where value->>'entityType'='season' loop
        if other_decision->>'cloudIdentity' like decision->>'cloudIdentity'||'/season:%' then path_value:='/mergeDecisions'; raise sqlstate 'P2507'; end if;
      end loop;
    end loop;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text,2402));
  current_payload:=tracker_private.owner_tracker_payload(caller_id);
  current_checksum:=tracker_private.canonical_tracker_sha256(current_payload);
  if current_checksum<>expected_cloud_checksum_value then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_restore_v2','entity','restore','entityId',source_checksum_value,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','cloud_state','expectedRevision',null,'currentRevision',null,'currentRecord',null,'expectedCloudChecksum',expected_cloud_checksum_value,'currentCloudChecksum',current_checksum),'error',null);
  end if;

  -- Resolve every reviewed target and revision before the first write.
  if mode_value='reviewed_merge' then
    for decision in select value from pg_catalog.jsonb_array_elements(decisions) loop
      source_identity:=decision->>'sourceIdentity'; cloud_identity:=decision->>'cloudIdentity'; entity_type_value:=decision->>'entityType'; action_value:=decision->>'action';
      if source_identity is not null then
        select value into source_show from pg_catalog.jsonb_array_elements(shows_source) where value->>'identity'=split_part(source_identity,'/season:',1);
        if source_show is null then path_value:='/mergeDecisions'; raise sqlstate 'P2501'; end if;
        if entity_type_value='season' then source_season_number:=split_part(source_identity,'/season:',2)::integer; select value into source_season from pg_catalog.jsonb_array_elements(source_show->'seasons') where (value->>'number')::integer=source_season_number; if source_season is null then path_value:='/mergeDecisions'; raise sqlstate 'P2501'; end if; end if;
      end if;
      if cloud_identity is not null then
        target_show_id:=split_part(split_part(cloud_identity,'show:',2),'/season:',1)::uuid;
        if entity_type_value='show' then select revision into current_revision_value from public.shows where id=target_show_id and user_id=caller_id;
        else target_season_number:=split_part(cloud_identity,'/season:',2)::integer; select revision into current_revision_value from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; end if;
        if not found then path_value:='/mergeDecisions'; raise sqlstate 'P2508'; end if;
        if action_value not like 'keep_%' and current_revision_value<>(decision->>'expectedRevision')::bigint then
          return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_restore_v2','entity','restore','entityId',source_checksum_value,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','cloud_state','expectedRevision',null,'currentRevision',null,'currentRecord',null,'expectedCloudChecksum',expected_cloud_checksum_value,'currentCloudChecksum',current_checksum),'error',null);
        end if;
      end if;
    end loop;
  end if;

  if mode_value='replace_cloud' then
    -- Preflight global UUID collisions without disclosing the conflicting row.
    if exists(select 1 from pg_catalog.jsonb_array_elements(shows_source) x where x->>'identity' like 'cloud:%' and exists(select 1 from public.shows s where s.id=substring(x->>'identity' from 7)::uuid and s.user_id<>caller_id)) then path_value:='/sourcePayload/shows'; raise sqlstate 'P2509'; end if;
    for show_source in select value from pg_catalog.jsonb_array_elements(shows_source) order by value->>'identity' collate "C" loop
      identity_value:=show_source->>'identity'; legacy_id_value:=nullif(show_source->>'legacyId','');
      if identity_value like 'cloud:%' then target_show_id:=substring(identity_value from 7)::uuid; select * into existing_show from public.shows where id=target_show_id and user_id=caller_id;
      else select * into existing_show from public.shows where user_id=caller_id and legacy_id=legacy_id_value; target_show_id:=existing_show.id; end if;
      if not found then
        if identity_value like 'cloud:%' then target_show_id:=substring(identity_value from 7)::uuid; else target_show_id:=pg_catalog.gen_random_uuid(); end if;
        insert into public.shows(id,user_id,legacy_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision) values(target_show_id,caller_id,legacy_id_value,show_source->>'platform',show_source->>'title',nullif(show_source->>'firstAirDate','')::date,show_source->>'synopsis',nullif(show_source->>'posterUrl',''),nullif(show_source->>'tmdbId','')::integer,nullif(show_source->>'tmdbPosterPath',''),(show_source->>'createdAt')::timestamptz,(show_source->>'updatedAt')::timestamptz,1); inserted_shows:=inserted_shows+1;
      else
        changed_value:=existing_show.legacy_id is distinct from legacy_id_value or existing_show.platform is distinct from show_source->>'platform' or existing_show.title is distinct from show_source->>'title' or existing_show.first_air_date is distinct from nullif(show_source->>'firstAirDate','')::date or existing_show.synopsis is distinct from show_source->>'synopsis' or existing_show.poster_url is distinct from nullif(show_source->>'posterUrl','') or existing_show.tmdb_id is distinct from nullif(show_source->>'tmdbId','')::integer or existing_show.tmdb_poster_path is distinct from nullif(show_source->>'tmdbPosterPath','') or existing_show.created_at is distinct from (show_source->>'createdAt')::timestamptz or existing_show.updated_at is distinct from (show_source->>'updatedAt')::timestamptz;
        if changed_value then update public.shows set legacy_id=legacy_id_value,platform=show_source->>'platform',title=show_source->>'title',first_air_date=nullif(show_source->>'firstAirDate','')::date,synopsis=show_source->>'synopsis',poster_url=nullif(show_source->>'posterUrl',''),tmdb_id=nullif(show_source->>'tmdbId','')::integer,tmdb_poster_path=nullif(show_source->>'tmdbPosterPath',''),created_at=(show_source->>'createdAt')::timestamptz,updated_at=(show_source->>'updatedAt')::timestamptz,revision=revision+1 where id=target_show_id and user_id=caller_id; updated_shows:=updated_shows+1; else unchanged_shows:=unchanged_shows+1; end if;
      end if;
      for season_source in select value from pg_catalog.jsonb_array_elements(show_source->'seasons') loop
        season_number_value:=(season_source->>'number')::integer; select * into existing_season from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=season_number_value;
        if not found then insert into public.season_progress(show_id,user_id,season_number,status,created_at,updated_at,revision) values(target_show_id,caller_id,season_number_value,(season_source->>'status')::public.season_status,(show_source->>'createdAt')::timestamptz,(show_source->>'updatedAt')::timestamptz,1); inserted_seasons:=inserted_seasons+1;
        elsif existing_season.status::text is distinct from season_source->>'status' or existing_season.created_at is distinct from (show_source->>'createdAt')::timestamptz or existing_season.updated_at is distinct from (show_source->>'updatedAt')::timestamptz then update public.season_progress set status=(season_source->>'status')::public.season_status,created_at=(show_source->>'createdAt')::timestamptz,updated_at=(show_source->>'updatedAt')::timestamptz,revision=revision+1 where id=existing_season.id and user_id=caller_id; updated_seasons:=updated_seasons+1;
        else unchanged_seasons:=unchanged_seasons+1; end if;
      end loop;
      with gone as (delete from public.season_progress sp where sp.show_id=target_show_id and sp.user_id=caller_id and not exists(select 1 from pg_catalog.jsonb_array_elements(show_source->'seasons') z where (z->>'number')::integer=sp.season_number) returning 1) select count(*) into removed_count from gone; deleted_seasons:=deleted_seasons+removed_count;
    end loop;
    select count(*) into removed_count
    from public.season_progress sp
    where sp.user_id=caller_id
      and sp.show_id in (
        select s.id from public.shows s
        where s.user_id=caller_id
          and not exists(
            select 1 from pg_catalog.jsonb_array_elements(shows_source) x
            where (x->>'identity' like 'cloud:%' and substring(x->>'identity' from 7)::uuid=s.id)
               or (x->>'identity' like 'legacy:%' and x->>'legacyId'=s.legacy_id)
          )
      );
    deleted_seasons:=deleted_seasons+removed_count;
    with gone as (delete from public.shows s where s.user_id=caller_id and not exists(select 1 from pg_catalog.jsonb_array_elements(shows_source) x where (x->>'identity' like 'cloud:%' and substring(x->>'identity' from 7)::uuid=s.id) or (x->>'identity' like 'legacy:%' and x->>'legacyId'=s.legacy_id)) returning id) select count(*) into removed_count from gone;
    deleted_shows:=deleted_shows+removed_count;
  else
    for decision in select value from pg_catalog.jsonb_array_elements(decisions) with ordinality d(value,ord) order by case when value->>'entityType'='show' then 0 else 1 end,d.ord loop
      source_identity:=decision->>'sourceIdentity'; cloud_identity:=decision->>'cloudIdentity'; action_value:=decision->>'action'; entity_type_value:=decision->>'entityType';
      if source_identity is not null then select value into source_show from pg_catalog.jsonb_array_elements(shows_source) where value->>'identity'=split_part(source_identity,'/season:',1); end if;
      if cloud_identity is not null then target_show_id:=split_part(split_part(cloud_identity,'show:',2),'/season:',1)::uuid; end if;
      if action_value='keep_cloud_record' then unchanged_shows:=unchanged_shows+1;
      elsif action_value='keep_cloud_season' then unchanged_seasons:=unchanged_seasons+1;
      elsif action_value='create_local_record' then
        identity_value:=source_show->>'identity'; if identity_value like 'cloud:%' then target_show_id:=substring(identity_value from 7)::uuid; else target_show_id:=pg_catalog.gen_random_uuid(); end if;
        if exists(select 1 from public.shows where id=target_show_id) then path_value:='/mergeDecisions'; raise sqlstate 'P2509'; end if;
        insert into public.shows(id,user_id,legacy_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision) values(target_show_id,caller_id,nullif(source_show->>'legacyId',''),source_show->>'platform',source_show->>'title',nullif(source_show->>'firstAirDate','')::date,source_show->>'synopsis',nullif(source_show->>'posterUrl',''),nullif(source_show->>'tmdbId','')::integer,nullif(source_show->>'tmdbPosterPath',''),(source_show->>'createdAt')::timestamptz,(source_show->>'updatedAt')::timestamptz,1); created_sources:=pg_catalog.array_append(created_sources,source_identity); created_ids:=pg_catalog.array_append(created_ids,target_show_id); inserted_shows:=inserted_shows+1;
      elsif action_value='apply_local_record' then
        select * into existing_show from public.shows where id=target_show_id and user_id=caller_id;
        changed_value:=existing_show.legacy_id is distinct from nullif(source_show->>'legacyId','') or existing_show.platform is distinct from source_show->>'platform' or existing_show.title is distinct from source_show->>'title' or existing_show.first_air_date is distinct from nullif(source_show->>'firstAirDate','')::date or existing_show.synopsis is distinct from source_show->>'synopsis' or existing_show.poster_url is distinct from nullif(source_show->>'posterUrl','') or existing_show.tmdb_id is distinct from nullif(source_show->>'tmdbId','')::integer or existing_show.tmdb_poster_path is distinct from nullif(source_show->>'tmdbPosterPath','') or existing_show.created_at is distinct from (source_show->>'createdAt')::timestamptz or existing_show.updated_at is distinct from (source_show->>'updatedAt')::timestamptz;
        if changed_value then update public.shows set legacy_id=nullif(source_show->>'legacyId',''),platform=source_show->>'platform',title=source_show->>'title',first_air_date=nullif(source_show->>'firstAirDate','')::date,synopsis=source_show->>'synopsis',poster_url=nullif(source_show->>'posterUrl',''),tmdb_id=nullif(source_show->>'tmdbId','')::integer,tmdb_poster_path=nullif(source_show->>'tmdbPosterPath',''),created_at=(source_show->>'createdAt')::timestamptz,updated_at=(source_show->>'updatedAt')::timestamptz,revision=revision+1 where id=target_show_id and user_id=caller_id; updated_shows:=updated_shows+1; else unchanged_shows:=unchanged_shows+1; end if;
      elsif action_value='delete_cloud_record' then select count(*) into removed_count from public.season_progress where show_id=target_show_id and user_id=caller_id; deleted_seasons:=deleted_seasons+removed_count; delete from public.shows where id=target_show_id and user_id=caller_id; deleted_shows:=deleted_shows+1;
      else
        source_season_number:=split_part(source_identity,'/season:',2)::integer; select value into source_season from pg_catalog.jsonb_array_elements(source_show->'seasons') where (value->>'number')::integer=source_season_number;
        if action_value='create_local_season' then
          target_show_id:=null;
          if split_part(source_identity,'/season:',1)=any(created_sources) then
            target_show_id:=created_ids[array_position(created_sources,split_part(source_identity,'/season:',1))];
          elsif split_part(source_identity,'/season:',1) like 'cloud:%' then
            select id into target_show_id from public.shows where id=substring(split_part(source_identity,'/season:',1) from 7)::uuid and user_id=caller_id;
          else
            select id into target_show_id from public.shows where legacy_id=source_show->>'legacyId' and user_id=caller_id;
          end if;
          if target_show_id is null then path_value:='/mergeDecisions'; raise sqlstate 'P2501'; end if;
          insert into public.season_progress(show_id,user_id,season_number,status,created_at,updated_at,revision) values(target_show_id,caller_id,source_season_number,(source_season->>'status')::public.season_status,(source_show->>'createdAt')::timestamptz,(source_show->>'updatedAt')::timestamptz,1); inserted_seasons:=inserted_seasons+1;
        elsif action_value='apply_local_season' then target_season_number:=split_part(cloud_identity,'/season:',2)::integer; select * into existing_season from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; if existing_season.status::text is distinct from source_season->>'status' or existing_season.created_at is distinct from (source_show->>'createdAt')::timestamptz or existing_season.updated_at is distinct from (source_show->>'updatedAt')::timestamptz then update public.season_progress set status=(source_season->>'status')::public.season_status,created_at=(source_show->>'createdAt')::timestamptz,updated_at=(source_show->>'updatedAt')::timestamptz,revision=revision+1 where id=existing_season.id and user_id=caller_id; updated_seasons:=updated_seasons+1; else unchanged_seasons:=unchanged_seasons+1; end if;
        elsif action_value='delete_cloud_season' then target_season_number:=split_part(cloud_identity,'/season:',2)::integer; delete from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; deleted_seasons:=deleted_seasons+1; end if;
      end if;
    end loop;
  end if;

  result_checksum:=tracker_private.canonical_tracker_sha256(tracker_private.owner_tracker_payload(caller_id));
  select count(*) into final_show_count from public.shows where user_id=caller_id;
  select count(*) into final_season_count from public.season_progress where user_id=caller_id;
  if mode_value='replace_cloud' and result_checksum<>source_checksum_value then raise sqlstate 'P2510'; end if;
  if mode_value='reviewed_merge' then unchanged_shows:=final_show_count-inserted_shows-updated_shows; unchanged_seasons:=final_season_count-inserted_seasons-updated_seasons; end if;
  completed_at_value:=pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_restore_v2','entity','restore','entityId',source_checksum_value,'data',pg_catalog.jsonb_build_object('mode',mode_value,'receipt',null,'sourceChecksum',source_checksum_value,'resultChecksum',result_checksum,'shows',pg_catalog.jsonb_build_object('inserted',inserted_shows,'updated',updated_shows,'deleted',deleted_shows,'unchanged',unchanged_shows),'seasons',pg_catalog.jsonb_build_object('inserted',inserted_seasons,'updated',updated_seasons,'deleted',deleted_seasons,'unchanged',unchanged_seasons),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(completed_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
exception
  when sqlstate 'P2501' or sqlstate 'P2502' or sqlstate 'P2503' or sqlstate 'P2504' or sqlstate 'P2505' or sqlstate 'P2506' or sqlstate 'P2507' or sqlstate 'P2508' or sqlstate 'P2509' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_restore_v2','entity','restore','entityId',case when request is null then null else request->>'sourceChecksum' end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code',case sqlstate when 'P2502' then 'invalid_input' when 'P2503' then 'duplicate_identity' when 'P2504' then 'duplicate_tmdb_id' when 'P2505' then 'source_checksum_mismatch' when 'P2506' then 'duplicate_decision' when 'P2507' then 'parent_child_conflict' when 'P2508' then 'record_not_found' when 'P2509' then 'identity_collision' else 'invalid_input' end,'message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',coalesce(path_value,''),'code',case when sqlstate='P2502' then 'unknown_field' else 'invalid_value' end,'message','Value is not supported or is malformed.')),'correlationId',null));
  when unique_violation then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_restore_v2','entity','restore','entityId',case when request is null then null else request->>'sourceChecksum' end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','identity_or_tmdb_collision','message','One or more fields are invalid.','fields','[]'::jsonb,'correlationId',null));
  when others then
    correlation_id:=pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_restore_v2','entity','restore','entityId',case when request is null then null else request->>'sourceChecksum' end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_restore_v2(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_restore_v2(jsonb) from public, anon;
grant execute on function public.tracker_restore_v2(jsonb) to authenticated;
revoke create on schema public from tracker_api_owner;
revoke tracker_api_owner from postgres;
