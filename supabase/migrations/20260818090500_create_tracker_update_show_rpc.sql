-- Phase 2.3 Step 3: revision-protected show updates.

grant tracker_api_owner to postgres;
grant create on schema public to tracker_api_owner;

create or replace function public.tracker_update_show(request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Intentionally mirrors Supabase Auth's auth.uid() helper: the dedicated
  -- owner cannot receive USAGE on the protected auth schema, so capture the
  -- same JWT sub/fallback value once without broadening that role's access.
  caller_claim text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  );
  caller_id uuid;
  show_id_value uuid;
  expected_revision_value bigint;
  patch jsonb;
  current_row public.shows%rowtype;
  changed_row public.shows%rowtype;
  unknown_key text;
  now_at timestamptz;
  correlation_id uuid;
  field_path text;
  field_code text;
  field_message text;
  new_tmdb_id integer;
  show_json jsonb;
  conflict_detected boolean := false;
begin
  begin
    caller_id := caller_claim::uuid;
  exception when invalid_text_representation then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_update_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_update_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;
  <<validate_input>>
  begin
  if request is null or pg_catalog.jsonb_typeof(request) <> 'object' then field_path := ''; field_code := 'object_required'; field_message := 'Request must be a JSON object.'; exit validate_input; end if;
  select key into unknown_key from pg_catalog.jsonb_object_keys(request) key where key not in ('showId','expectedRevision','showPatch') order by key limit 1;
  if unknown_key is not null then field_path := '/'||unknown_key; field_code := 'unknown_field'; field_message := 'Field is not permitted.'; exit validate_input; end if;
  if (select count(*) from pg_catalog.jsonb_object_keys(request)) <> 3 or not request ?& array['showId','expectedRevision','showPatch'] then field_path := ''; field_code := 'invalid_request_shape'; field_message := 'Request must contain exactly showId, expectedRevision, and showPatch.'; exit validate_input; end if;
  if pg_catalog.jsonb_typeof(request->'showId') <> 'string' then field_path := '/showId'; field_code := 'invalid_uuid'; field_message := 'Show ID must be a UUID string.'; exit validate_input; end if;
  begin show_id_value := (request->>'showId')::uuid; exception when invalid_text_representation then field_path := '/showId'; field_code := 'invalid_uuid'; field_message := 'Show ID must be a UUID string.'; exit validate_input; end;
  if pg_catalog.jsonb_typeof(request->'expectedRevision') <> 'string' or request->>'expectedRevision' !~ '^[1-9][0-9]*$' then field_path := '/expectedRevision'; field_code := 'invalid_revision'; field_message := 'Expected revision must be a positive decimal string.'; exit validate_input; end if;
  begin expected_revision_value := (request->>'expectedRevision')::bigint; exception when numeric_value_out_of_range then field_path := '/expectedRevision'; field_code := 'invalid_revision'; field_message := 'Expected revision must be within bigint range.'; exit validate_input; end;
  patch := request->'showPatch';
  if pg_catalog.jsonb_typeof(patch) <> 'object' or (select count(*) from pg_catalog.jsonb_object_keys(patch)) = 0 then field_path := '/showPatch'; field_code := 'non_empty_object_required'; field_message := 'Show patch must be a non-empty object.'; exit validate_input; end if;
  select key into unknown_key from pg_catalog.jsonb_object_keys(patch) key where key not in ('platform','title','firstAirDate','synopsis','posterUrl','tmdbId','tmdbPosterPath') order by key limit 1;
  if unknown_key is not null then field_path := '/showPatch/'||unknown_key; field_code := 'unknown_or_immutable_field'; field_message := 'Field is not mutable.'; exit validate_input; end if;

  if patch ? 'platform' and (pg_catalog.jsonb_typeof(patch->'platform') <> 'string' or char_length(patch->>'platform') not between 1 and 100 or patch->>'platform' <> btrim(patch->>'platform')) then field_path := '/showPatch/platform'; field_code := 'invalid_string'; field_message := 'Platform must be a trimmed string from 1 through 100 characters.'; exit validate_input; end if;
  if patch ? 'title' and (pg_catalog.jsonb_typeof(patch->'title') <> 'string' or char_length(patch->>'title') not between 1 and 300 or patch->>'title' <> btrim(patch->>'title')) then field_path := '/showPatch/title'; field_code := case when patch->'title' = 'null'::jsonb then 'null_not_allowed' else 'invalid_string' end; field_message := 'Title must be a trimmed string from 1 through 300 characters.'; exit validate_input; end if;
  if patch ? 'synopsis' and (pg_catalog.jsonb_typeof(patch->'synopsis') <> 'string' or char_length(patch->>'synopsis') > 20000) then field_path := '/showPatch/synopsis'; field_code := case when patch->'synopsis' = 'null'::jsonb then 'null_not_allowed' else 'invalid_string' end; field_message := 'Synopsis must be a string no longer than 20000 characters.'; exit validate_input; end if;
  if patch ? 'firstAirDate' and patch->'firstAirDate' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(patch->'firstAirDate') <> 'string' or patch->>'firstAirDate' !~ '^\d{4}-\d{2}-\d{2}$' then field_path := '/showPatch/firstAirDate'; field_code := 'invalid_date'; field_message := 'First air date must be null or a valid YYYY-MM-DD date.'; exit validate_input; end if;
    begin perform (patch->>'firstAirDate')::date; exception when datetime_field_overflow then field_path := '/showPatch/firstAirDate'; field_code := 'invalid_date'; field_message := 'First air date must be null or a valid YYYY-MM-DD date.'; exit validate_input; end;
  end if;
  if patch ? 'posterUrl' and patch->'posterUrl' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(patch->'posterUrl') <> 'string' or char_length(patch->>'posterUrl') > 2048 or patch->>'posterUrl' !~* '^https?://') then field_path := '/showPatch/posterUrl'; field_code := 'invalid_url'; field_message := 'Poster URL must be null or an absolute HTTP(S) URL up to 2048 characters.'; exit validate_input; end if;
  if patch ? 'tmdbPosterPath' and patch->'tmdbPosterPath' <> 'null'::jsonb and (pg_catalog.jsonb_typeof(patch->'tmdbPosterPath') <> 'string' or char_length(patch->>'tmdbPosterPath') > 255 or patch->>'tmdbPosterPath' !~ '^/') then field_path := '/showPatch/tmdbPosterPath'; field_code := 'invalid_path'; field_message := 'TMDB poster path must be null or a leading-slash string up to 255 characters.'; exit validate_input; end if;
  if patch ? 'tmdbId' and patch->'tmdbId' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(patch->'tmdbId') <> 'number' or patch->>'tmdbId' !~ '^[0-9]+$' then field_path := '/showPatch/tmdbId'; field_code := 'invalid_integer'; field_message := 'TMDB ID must be null or a positive 32-bit integer.'; exit validate_input; end if;
    begin new_tmdb_id := (patch->>'tmdbId')::integer; exception when numeric_value_out_of_range then new_tmdb_id := null; end;
    if new_tmdb_id is null or new_tmdb_id < 1 then field_path := '/showPatch/tmdbId'; field_code := 'invalid_integer'; field_message := 'TMDB ID must be null or a positive 32-bit integer.'; exit validate_input; end if;
  end if;
  end validate_input;

  if field_code is not null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_update_show','entity','show','entityId',case when show_id_value is null then null else show_id_value::text end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',field_path,'code',field_code,'message',field_message)),'correlationId',null));
  end if;

  select * into current_row from public.shows where id=show_id_value and user_id=caller_id;
  if not found then return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','not_found','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','not_found','message','Show was not found.','fields','[]'::jsonb,'correlationId',null)); end if;
  if current_row.revision <> expected_revision_value then conflict_detected := true; end if;
  if not conflict_detected and new_tmdb_id is not null and exists(select 1 from public.shows where user_id=caller_id and tmdb_id=new_tmdb_id and id<>show_id_value) then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','That TMDB ID is already used by this tracker.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/showPatch/tmdbId','code','duplicate_tmdb_id','message','TMDB ID must be unique within the tracker.')),'correlationId',null));
  end if;

  if not conflict_detected then
  now_at := pg_catalog.clock_timestamp();
  update public.shows set
    platform=case when patch?'platform' then patch->>'platform' else platform end,
    title=case when patch?'title' then patch->>'title' else title end,
    first_air_date=case when patch?'firstAirDate' then nullif(patch->>'firstAirDate','')::date else first_air_date end,
    synopsis=case when patch?'synopsis' then patch->>'synopsis' else synopsis end,
    poster_url=case when patch?'posterUrl' then nullif(patch->>'posterUrl','') else poster_url end,
    tmdb_id=case when patch?'tmdbId' then nullif(patch->>'tmdbId','')::integer else tmdb_id end,
    tmdb_poster_path=case when patch?'tmdbPosterPath' then nullif(patch->>'tmdbPosterPath','') else tmdb_poster_path end,
    updated_at=now_at, revision=revision+1
  where id=show_id_value and user_id=caller_id and revision=expected_revision_value returning * into changed_row;
  if not found then
    select * into current_row from public.shows where id=show_id_value and user_id=caller_id;
    if not found then return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','not_found','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','not_found','message','Show was not found.','fields','[]'::jsonb,'correlationId',null)); end if;
    conflict_detected := true;
  end if;
  end if;
  if conflict_detected then
    select pg_catalog.jsonb_build_object('id',s.id::text,'legacyId',s.legacy_id,'platform',s.platform,'title',s.title,'firstAirDate',s.first_air_date::text,'synopsis',s.synopsis,'posterUrl',s.poster_url,'tmdbId',s.tmdb_id,'tmdbPosterPath',s.tmdb_poster_path,'createdAt',pg_catalog.to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision::text) into show_json from public.shows s where s.id=current_row.id and s.user_id=caller_id;
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','revision','expectedRevision',expected_revision_value::text,'currentRevision',current_row.revision::text,'currentRecord',show_json,'expectedCloudChecksum',null,'currentCloudChecksum',null),'error',null);
  end if;
  current_row := changed_row;
  select pg_catalog.jsonb_build_object('id',s.id::text,'legacyId',s.legacy_id,'platform',s.platform,'title',s.title,'firstAirDate',s.first_air_date::text,'synopsis',s.synopsis,'posterUrl',s.poster_url,'tmdbId',s.tmdb_id,'tmdbPosterPath',s.tmdb_poster_path,'createdAt',pg_catalog.to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision::text) into show_json from public.shows s where s.id=current_row.id and s.user_id=caller_id;
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',pg_catalog.jsonb_build_object('show',show_json),'conflict',null,'error',null);

exception
  when unique_violation then
    if patch ? 'tmdbId' and patch->'tmdbId' <> 'null'::jsonb then return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','That TMDB ID is already used by this tracker.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/showPatch/tmdbId','code','duplicate_tmdb_id','message','TMDB ID must be unique within the tracker.')),'correlationId',null)); end if;
    correlation_id:=pg_catalog.gen_random_uuid(); return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_update_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  when others then correlation_id:=pg_catalog.gen_random_uuid(); return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_update_show','entity','show','entityId',case when show_id_value is null then null else show_id_value::text end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_update_show(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_update_show(jsonb) from public, anon;
grant execute on function public.tracker_update_show(jsonb) to authenticated;
revoke create on schema public from tracker_api_owner;
revoke tracker_api_owner from postgres;
