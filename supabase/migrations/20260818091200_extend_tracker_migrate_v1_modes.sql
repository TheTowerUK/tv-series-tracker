-- Phase 2.4 Step 3: keep-cloud and explicit reviewed-merge modes.

grant tracker_api_owner to postgres;
grant create on schema public to tracker_api_owner;
grant create on schema tracker_private to tracker_api_owner;

alter function public.tracker_migrate_v1(jsonb) set schema tracker_private;
alter function tracker_private.tracker_migrate_v1(jsonb) rename to migrate_v1_replace;
revoke all on function tracker_private.migrate_v1_replace(jsonb) from public, anon, authenticated;
grant execute on function tracker_private.migrate_v1_replace(jsonb) to tracker_api_owner;

create function public.tracker_migrate_v1(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_claim text := coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub');
  caller_id uuid;
  mode_value text;
  migration_key_value text;
  source_checksum_value text;
  expected_cloud_checksum_value text;
  current_payload jsonb;
  current_checksum text;
  validation_cloud_checksum text;
  result_payload jsonb;
  result_checksum text;
  validation_result jsonb;
  decisions jsonb;
  decision jsonb;
  other_decision jsonb;
  source_show jsonb;
  source_season jsonb;
  source_identity text;
  cloud_identity text;
  action_value text;
  entity_type_value text;
  target_show_id uuid;
  target_season_number integer;
  source_legacy_id text;
  source_season_number integer;
  created_sources text[] := array[]::text[];
  created_ids uuid[] := array[]::uuid[];
  seen_targets text[] := array[]::text[];
  target_key text;
  index_value integer := 0;
  inserted_shows integer := 0; updated_shows integer := 0; deleted_shows integer := 0; unchanged_shows integer := 0;
  inserted_seasons integer := 0; updated_seasons integer := 0; deleted_seasons integer := 0; unchanged_seasons integer := 0;
  final_show_count integer; final_season_count integer; removed_count integer;
  completed_at_value timestamptz;
  receipt_row public.migration_receipts%rowtype;
  existing_show public.shows%rowtype;
  current_revision_value bigint;
  changed_value boolean;
  correlation_id uuid;
  path_value text;
begin
  begin caller_id:=caller_claim::uuid; exception when invalid_text_representation then caller_id:=null; end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;
  if request is null or pg_catalog.jsonb_typeof(request)<>'object' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','','code','object_required','message','Request must be a JSON object.')),'correlationId',null));
  end if;
  mode_value:=request->>'mode'; migration_key_value:=request->>'migrationKey'; source_checksum_value:=request->>'sourceChecksum'; expected_cloud_checksum_value:=request->>'expectedCloudChecksum';
  if mode_value='replace_cloud' then return tracker_private.migrate_v1_replace(request); end if;
  if mode_value not in ('keep_cloud','reviewed_merge') then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/mode','code','invalid_value','message','Mode is not supported.')),'correlationId',null));
  end if;

  -- Reuse the accepted full v1 validator with a deliberately different
  -- expected-cloud checksum. The private implementation validates and hashes
  -- the complete source before reaching that conflict, and returns before
  -- any table mutation. This is not a public dry-run mode.
  current_payload:=tracker_private.owner_tracker_payload(caller_id);
  current_checksum:=tracker_private.canonical_tracker_sha256(current_payload);
  validation_cloud_checksum:=case when current_checksum<>repeat('0',64) then repeat('0',64) else repeat('1',64) end;
  validation_result:=tracker_private.migrate_v1_replace(request||pg_catalog.jsonb_build_object('mode','replace_cloud','expectedCloudChecksum',validation_cloud_checksum,'mergeDecisions',pg_catalog.jsonb_build_object('decisions','[]'::jsonb)));
  if validation_result->>'outcome'<>'conflict' then return validation_result; end if;

  decisions:=request->'mergeDecisions';
  if mode_value='keep_cloud' then
    if decisions is distinct from '{"decisions":[]}'::jsonb then path_value:='/mergeDecisions'; raise sqlstate 'P2401'; end if;
    current_payload:=tracker_private.owner_tracker_payload(caller_id); current_checksum:=tracker_private.canonical_tracker_sha256(current_payload);
    select count(*) into final_show_count from public.shows where user_id=caller_id;
    select count(*) into final_season_count from public.season_progress where user_id=caller_id;
    completed_at_value:=pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',pg_catalog.jsonb_build_object('mode','keep_cloud','receipt',null,'sourceChecksum',source_checksum_value,'resultChecksum',current_checksum,'shows',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_show_count),'seasons',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_season_count),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(completed_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
  end if;

  if pg_catalog.jsonb_typeof(decisions)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(decisions))<>1 or pg_catalog.jsonb_typeof(decisions->'decisions')<>'array' then path_value:='/mergeDecisions'; raise sqlstate 'P2401'; end if;
  decisions:=decisions->'decisions';
  for decision in select value from pg_catalog.jsonb_array_elements(decisions) with ordinality d(value,ord) order by case when value->>'entityType'='show' then 0 else 1 end,d.ord loop
    path_value:='/mergeDecisions/decisions/'||index_value;
    if pg_catalog.jsonb_typeof(decision)<>'object' or (select count(*) from pg_catalog.jsonb_object_keys(decision))<>5 or not decision ?& array['entityType','sourceIdentity','cloudIdentity','action','expectedRevision'] then raise sqlstate 'P2401'; end if;
    entity_type_value:=decision->>'entityType'; source_identity:=decision->>'sourceIdentity'; cloud_identity:=decision->>'cloudIdentity'; action_value:=decision->>'action';
    if entity_type_value='show' and action_value not in ('keep_cloud_record','apply_local_record','create_local_record','delete_cloud_record') then raise sqlstate 'P2401'; end if;
    if entity_type_value='season' and action_value not in ('keep_cloud_season','apply_local_season','create_local_season','delete_cloud_season') then raise sqlstate 'P2401'; end if;
    if entity_type_value not in ('show','season') then raise sqlstate 'P2401'; end if;
    if action_value like 'keep_%' then
      if cloud_identity is null or decision->'expectedRevision'<>'null'::jsonb then raise sqlstate 'P2401'; end if;
    elsif action_value like 'create_%' then
      if source_identity is null or decision->'cloudIdentity'<>'null'::jsonb or decision->'expectedRevision'<>'null'::jsonb then raise sqlstate 'P2401'; end if;
    else
      if cloud_identity is null or decision->'expectedRevision'='null'::jsonb or pg_catalog.jsonb_typeof(decision->'expectedRevision')<>'string' or decision->>'expectedRevision' !~ '^[1-9][0-9]{0,18}$' then raise sqlstate 'P2401'; end if;
      begin perform (decision->>'expectedRevision')::bigint; exception when others then raise sqlstate 'P2401'; end;
      if action_value like 'apply_%' and source_identity is null then raise sqlstate 'P2401'; end if;
    end if;
    if source_identity is not null and ((entity_type_value='show' and source_identity !~ '^legacy:.+$') or (entity_type_value='season' and source_identity !~ '^legacy:.+/season:[1-9][0-9]*$')) then raise sqlstate 'P2401'; end if;
    if cloud_identity is not null and ((entity_type_value='show' and cloud_identity !~ '^show:[0-9a-f-]{36}$') or (entity_type_value='season' and cloud_identity !~ '^show:[0-9a-f-]{36}/season:[1-9][0-9]*$')) then raise sqlstate 'P2401'; end if;
    target_key:=coalesce(cloud_identity,'source:'||source_identity);
    if target_key=any(seen_targets) then raise sqlstate 'P2402'; end if; seen_targets:=pg_catalog.array_append(seen_targets,target_key);
    index_value:=index_value+1;
  end loop;
  -- A deleted parent cannot also have an explicit child decision.
  for decision in select value from pg_catalog.jsonb_array_elements(decisions) where value->>'action'='delete_cloud_record' loop
    for other_decision in select value from pg_catalog.jsonb_array_elements(decisions) where value->>'entityType'='season' loop
      if other_decision->>'cloudIdentity' like (decision->>'cloudIdentity')||'/season:%' then path_value:='/mergeDecisions'; raise sqlstate 'P2403'; end if;
    end loop;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text,2401));
  current_payload:=tracker_private.owner_tracker_payload(caller_id); current_checksum:=tracker_private.canonical_tracker_sha256(current_payload);
  if current_checksum<>expected_cloud_checksum_value then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','cloud_state','expectedRevision',null,'currentRevision',null,'currentRecord',null,'expectedCloudChecksum',expected_cloud_checksum_value,'currentCloudChecksum',current_checksum),'error',null);
  end if;
  select * into receipt_row from public.migration_receipts where user_id=caller_id and migration_key=migration_key_value;
  if found and receipt_row.source_checksum=source_checksum_value and receipt_row.result_checksum=current_checksum then
    select count(*) into final_show_count from public.shows where user_id=caller_id; select count(*) into final_season_count from public.season_progress where user_id=caller_id;
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',pg_catalog.jsonb_build_object('mode','reviewed_merge','receipt',pg_catalog.jsonb_build_object('migrationKey',migration_key_value,'sourceSchemaVersion',1),'sourceChecksum',source_checksum_value,'resultChecksum',current_checksum,'shows',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_show_count),'seasons',pg_catalog.jsonb_build_object('inserted',0,'updated',0,'deleted',0,'unchanged',final_season_count),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(receipt_row.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
  end if;

  -- Validate all owner targets and inspected revisions before any mutation.
  for decision in select value from pg_catalog.jsonb_array_elements(decisions) with ordinality d(value,ord) order by case when value->>'entityType'='show' then 0 else 1 end,d.ord loop
    action_value:=decision->>'action'; entity_type_value:=decision->>'entityType'; cloud_identity:=decision->>'cloudIdentity'; source_identity:=decision->>'sourceIdentity';
    if source_identity is not null then
      source_legacy_id:=regexp_replace(split_part(source_identity,'/season:',1),'^legacy:','');
      select value into source_show from pg_catalog.jsonb_array_elements(request->'sourcePayload'->'shows') where value->>'id'=source_legacy_id;
      if source_show is null then path_value:='/mergeDecisions'; raise sqlstate 'P2401'; end if;
      if entity_type_value='season' then source_season_number:=split_part(source_identity,'/season:',2)::integer; select value into source_season from pg_catalog.jsonb_array_elements(source_show->'seasons') where (value->>'number')::integer=source_season_number; if source_season is null then raise sqlstate 'P2401'; end if; end if;
    end if;
    if cloud_identity is not null then
      target_show_id:=split_part(split_part(cloud_identity,'show:',2),'/season:',1)::uuid;
      if entity_type_value='show' then select revision into current_revision_value from public.shows where id=target_show_id and user_id=caller_id;
      else target_season_number:=split_part(cloud_identity,'/season:',2)::integer; select revision into current_revision_value from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; end if;
      if not found then path_value:='/mergeDecisions'; raise sqlstate 'P2404'; end if;
      if action_value not like 'keep_%' and current_revision_value<>(decision->>'expectedRevision')::bigint then
        return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','cloud_state','expectedRevision',null,'currentRevision',null,'currentRecord',null,'expectedCloudChecksum',expected_cloud_checksum_value,'currentCloudChecksum',current_checksum),'error',null);
      end if;
    end if;
  end loop;

  for decision in select value from pg_catalog.jsonb_array_elements(decisions) with ordinality d(value,ord) order by case when value->>'entityType'='show' then 0 else 1 end,d.ord loop
    action_value:=decision->>'action'; entity_type_value:=decision->>'entityType'; cloud_identity:=decision->>'cloudIdentity'; source_identity:=decision->>'sourceIdentity';
    if source_identity is not null then source_legacy_id:=regexp_replace(split_part(source_identity,'/season:',1),'^legacy:',''); select value into source_show from pg_catalog.jsonb_array_elements(request->'sourcePayload'->'shows') where value->>'id'=source_legacy_id; end if;
    if cloud_identity is not null then target_show_id:=split_part(split_part(cloud_identity,'show:',2),'/season:',1)::uuid; end if;
    if action_value='keep_cloud_record' then unchanged_shows:=unchanged_shows+1;
    elsif action_value='keep_cloud_season' then unchanged_seasons:=unchanged_seasons+1;
    elsif action_value='create_local_record' then
      insert into public.shows(user_id,legacy_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision) values(caller_id,source_show->>'id',source_show->>'platform',source_show->>'title',nullif(source_show->>'firstAirDate','')::date,coalesce(source_show->>'description',''),nullif(source_show->>'posterUrl',''),coalesce(nullif(source_show->'tmdb'->>'id','')::integer,nullif(source_show->>'tmdbId','')::integer),coalesce(nullif(source_show->'tmdb'->>'posterPath',''),nullif(source_show->>'tmdbPosterPath','')),(source_show->>'createdAt')::timestamptz,(source_show->>'updatedAt')::timestamptz,1) returning id into target_show_id;
      created_sources:=pg_catalog.array_append(created_sources,'legacy:'||(source_show->>'id')); created_ids:=pg_catalog.array_append(created_ids,target_show_id); inserted_shows:=inserted_shows+1;
    elsif action_value='apply_local_record' then
      select * into existing_show from public.shows where id=target_show_id and user_id=caller_id;
      changed_value:=existing_show.legacy_id is distinct from source_show->>'id' or existing_show.platform is distinct from source_show->>'platform' or existing_show.title is distinct from source_show->>'title' or existing_show.first_air_date is distinct from nullif(source_show->>'firstAirDate','')::date or existing_show.synopsis is distinct from coalesce(source_show->>'description','') or existing_show.poster_url is distinct from nullif(source_show->>'posterUrl','') or existing_show.tmdb_id is distinct from coalesce(nullif(source_show->'tmdb'->>'id','')::integer,nullif(source_show->>'tmdbId','')::integer) or existing_show.tmdb_poster_path is distinct from coalesce(nullif(source_show->'tmdb'->>'posterPath',''),nullif(source_show->>'tmdbPosterPath','')) or existing_show.created_at is distinct from (source_show->>'createdAt')::timestamptz or existing_show.updated_at is distinct from (source_show->>'updatedAt')::timestamptz;
      if changed_value then update public.shows set legacy_id=source_show->>'id',platform=source_show->>'platform',title=source_show->>'title',first_air_date=nullif(source_show->>'firstAirDate','')::date,synopsis=coalesce(source_show->>'description',''),poster_url=nullif(source_show->>'posterUrl',''),tmdb_id=coalesce(nullif(source_show->'tmdb'->>'id','')::integer,nullif(source_show->>'tmdbId','')::integer),tmdb_poster_path=coalesce(nullif(source_show->'tmdb'->>'posterPath',''),nullif(source_show->>'tmdbPosterPath','')),created_at=(source_show->>'createdAt')::timestamptz,updated_at=(source_show->>'updatedAt')::timestamptz,revision=revision+1 where id=target_show_id and user_id=caller_id; updated_shows:=updated_shows+1; end if;
    elsif action_value='delete_cloud_record' then
      select count(*) into removed_count from public.season_progress where show_id=target_show_id and user_id=caller_id; deleted_seasons:=deleted_seasons+removed_count; delete from public.shows where id=target_show_id and user_id=caller_id; deleted_shows:=deleted_shows+1;
    else
      source_season_number:=split_part(source_identity,'/season:',2)::integer; select value into source_season from pg_catalog.jsonb_array_elements(source_show->'seasons') where (value->>'number')::integer=source_season_number;
      if action_value='create_local_season' then
        if 'legacy:'||(source_show->>'id')=any(created_sources) then target_show_id:=created_ids[array_position(created_sources,'legacy:'||(source_show->>'id'))]; else select id into target_show_id from public.shows where user_id=caller_id and legacy_id=source_show->>'id'; end if;
        if target_show_id is null then raise sqlstate 'P2401'; end if;
        insert into public.season_progress(show_id,user_id,season_number,status,created_at,updated_at,revision) values(target_show_id,caller_id,source_season_number,(case source_season->>'status' when 'Not Started' then 'not_started' when 'Watching' then 'watching' when 'Completed' then 'completed' when 'Purchase Only' then 'purchase_only' else 'region_blocked' end)::public.season_status,(source_show->>'createdAt')::timestamptz,(source_show->>'updatedAt')::timestamptz,1); inserted_seasons:=inserted_seasons+1;
      elsif action_value='apply_local_season' then target_season_number:=split_part(cloud_identity,'/season:',2)::integer; select status::text is distinct from (case source_season->>'status' when 'Not Started' then 'not_started' when 'Watching' then 'watching' when 'Completed' then 'completed' when 'Purchase Only' then 'purchase_only' else 'region_blocked' end) into changed_value from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; if changed_value then update public.season_progress set status=(case source_season->>'status' when 'Not Started' then 'not_started' when 'Watching' then 'watching' when 'Completed' then 'completed' when 'Purchase Only' then 'purchase_only' else 'region_blocked' end)::public.season_status,updated_at=(source_show->>'updatedAt')::timestamptz,revision=revision+1 where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; updated_seasons:=updated_seasons+1; end if;
      elsif action_value='delete_cloud_season' then target_season_number:=split_part(cloud_identity,'/season:',2)::integer; delete from public.season_progress where show_id=target_show_id and user_id=caller_id and season_number=target_season_number; deleted_seasons:=deleted_seasons+1;
      end if;
    end if;
  end loop;
  result_payload:=tracker_private.owner_tracker_payload(caller_id); result_checksum:=tracker_private.canonical_tracker_sha256(result_payload); select count(*) into final_show_count from public.shows where user_id=caller_id; select count(*) into final_season_count from public.season_progress where user_id=caller_id;
  completed_at_value:=pg_catalog.clock_timestamp();
  insert into public.migration_receipts(user_id,migration_key,source_schema_version,completed_at,source_checksum,result_checksum,imported_show_count,imported_season_count) values(caller_id,migration_key_value,1,completed_at_value,source_checksum_value,result_checksum,final_show_count,final_season_count) on conflict(user_id,migration_key) do update set source_schema_version=excluded.source_schema_version,completed_at=excluded.completed_at,source_checksum=excluded.source_checksum,result_checksum=excluded.result_checksum,imported_show_count=excluded.imported_show_count,imported_season_count=excluded.imported_season_count;
  unchanged_shows:=final_show_count-inserted_shows-updated_shows; unchanged_seasons:=final_season_count-inserted_seasons-updated_seasons;
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',pg_catalog.jsonb_build_object('mode','reviewed_merge','receipt',pg_catalog.jsonb_build_object('migrationKey',migration_key_value,'sourceSchemaVersion',1),'sourceChecksum',source_checksum_value,'resultChecksum',result_checksum,'shows',pg_catalog.jsonb_build_object('inserted',inserted_shows,'updated',updated_shows,'deleted',deleted_shows,'unchanged',unchanged_shows),'seasons',pg_catalog.jsonb_build_object('inserted',inserted_seasons,'updated',updated_seasons,'deleted',deleted_seasons,'unchanged',unchanged_seasons),'finalTotals',pg_catalog.jsonb_build_object('shows',final_show_count,'seasons',final_season_count),'completedAt',pg_catalog.to_char(completed_at_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'conflict',null,'error',null);
exception
  when sqlstate 'P2401' or sqlstate 'P2402' or sqlstate 'P2403' or sqlstate 'P2404' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code',case sqlstate when 'P2402' then 'duplicate_decision' when 'P2403' then 'parent_child_conflict' when 'P2404' then 'record_not_found' else 'invalid_input' end,'message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',coalesce(path_value,'/mergeDecisions'),'code','invalid_value','message','Decision is invalid.')),'correlationId',null));
  when unique_violation then return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','One or more fields are invalid.','fields','[]'::jsonb,'correlationId',null));
  when others then correlation_id:=pg_catalog.gen_random_uuid(); return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_migrate_v1','entity','migration','entityId',migration_key_value,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_migrate_v1(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_migrate_v1(jsonb) from public, anon;
grant execute on function public.tracker_migrate_v1(jsonb) to authenticated;
revoke create on schema public from tracker_api_owner;
revoke create on schema tracker_private from tracker_api_owner;
revoke tracker_api_owner from postgres;
