-- Phase 2.3 Step 3: authenticated show creation boundary.

grant tracker_api_owner to postgres;
grant create on schema public to tracker_api_owner;

create or replace function public.tracker_create_show(request jsonb)
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
  now_at timestamptz;
  platform_value text;
  title_value text;
  first_air_date_value date;
  synopsis_value text := '';
  poster_url_value text;
  tmdb_id_value integer;
  tmdb_poster_path_value text;
  seasons_value jsonb := '[]'::jsonb;
  season_item jsonb;
  season_number_value integer;
  season_status_value public.season_status;
  unknown_key text;
  show_json jsonb;
  seasons_json jsonb;
  correlation_id uuid;
begin
  begin
    caller_id := caller_claim::uuid;
  exception when invalid_text_representation then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;

  if request is null or pg_catalog.jsonb_typeof(request) <> 'object' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','','code','object_required','message','Request must be a JSON object.')),'correlationId',null));
  end if;

  select key into unknown_key from pg_catalog.jsonb_object_keys(request) key
  where key not in ('platform','title','firstAirDate','synopsis','posterUrl','tmdbId','tmdbPosterPath','seasons') order by key limit 1;
  if unknown_key is not null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/' || unknown_key,'code','unknown_field','message','Field is not permitted.')),'correlationId',null));
  end if;

  if not request ? 'platform' or pg_catalog.jsonb_typeof(request->'platform') <> 'string' or char_length(request->>'platform') not between 1 and 100 or request->>'platform' <> btrim(request->>'platform') then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/platform','code','invalid_string','message','Platform must be a trimmed string from 1 through 100 characters.')),'correlationId',null));
  end if;
  platform_value := request->>'platform';

  if not request ? 'title' or pg_catalog.jsonb_typeof(request->'title') <> 'string' or char_length(request->>'title') not between 1 and 300 or request->>'title' <> btrim(request->>'title') then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/title','code','invalid_string','message','Title must be a trimmed string from 1 through 300 characters.')),'correlationId',null));
  end if;
  title_value := request->>'title';

  if request ? 'firstAirDate' and request->'firstAirDate' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(request->'firstAirDate') <> 'string' or request->>'firstAirDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/firstAirDate','code','invalid_date','message','First air date must be null or a valid YYYY-MM-DD date.')),'correlationId',null));
    end if;
    begin first_air_date_value := (request->>'firstAirDate')::date; exception when datetime_field_overflow then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/firstAirDate','code','invalid_date','message','First air date must be null or a valid YYYY-MM-DD date.')),'correlationId',null));
    end;
  end if;

  if request ? 'synopsis' then
    if pg_catalog.jsonb_typeof(request->'synopsis') <> 'string' or char_length(request->>'synopsis') > 20000 then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/synopsis','code','invalid_string','message','Synopsis must be a string no longer than 20000 characters.')),'correlationId',null));
    end if;
    synopsis_value := request->>'synopsis';
  end if;

  if request ? 'posterUrl' and request->'posterUrl' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(request->'posterUrl') <> 'string' or char_length(request->>'posterUrl') > 2048 or request->>'posterUrl' !~* '^https?://' then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/posterUrl','code','invalid_url','message','Poster URL must be null or an absolute HTTP(S) URL up to 2048 characters.')),'correlationId',null));
    end if;
    poster_url_value := request->>'posterUrl';
  end if;

  if request ? 'tmdbId' and request->'tmdbId' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(request->'tmdbId') <> 'number' or (request->>'tmdbId') !~ '^[0-9]+$' then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/tmdbId','code','invalid_integer','message','TMDB ID must be null or a positive 32-bit integer.')),'correlationId',null));
    end if;
    begin tmdb_id_value := (request->>'tmdbId')::integer; exception when numeric_value_out_of_range then tmdb_id_value := null; end;
    if tmdb_id_value is null or tmdb_id_value < 1 then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/tmdbId','code','invalid_integer','message','TMDB ID must be null or a positive 32-bit integer.')),'correlationId',null));
    end if;
  end if;

  if request ? 'tmdbPosterPath' and request->'tmdbPosterPath' <> 'null'::jsonb then
    if pg_catalog.jsonb_typeof(request->'tmdbPosterPath') <> 'string' or char_length(request->>'tmdbPosterPath') > 255 or request->>'tmdbPosterPath' !~ '^/' then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/tmdbPosterPath','code','invalid_path','message','TMDB poster path must be null or a leading-slash string up to 255 characters.')),'correlationId',null));
    end if;
    tmdb_poster_path_value := request->>'tmdbPosterPath';
  end if;

  if request ? 'seasons' then seasons_value := request->'seasons'; end if;
  if pg_catalog.jsonb_typeof(seasons_value) <> 'array' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/seasons','code','array_required','message','Seasons must be an array.')),'correlationId',null));
  end if;

  for season_item in select value from pg_catalog.jsonb_array_elements(seasons_value) loop
    if pg_catalog.jsonb_typeof(season_item) <> 'object' or (select count(*) from pg_catalog.jsonb_object_keys(season_item)) <> 2 or not season_item ?& array['number','status'] then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/seasons','code','invalid_season','message','Each season must contain exactly number and status.')),'correlationId',null));
    end if;
    if pg_catalog.jsonb_typeof(season_item->'number') <> 'number' or season_item->>'number' !~ '^[0-9]+$' or (season_item->>'number')::numeric not between 1 and 32767 then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/seasons','code','invalid_season_number','message','Season number must be an integer from 1 through 32767.')),'correlationId',null));
    end if;
    if pg_catalog.jsonb_typeof(season_item->'status') <> 'string' or season_item->>'status' not in ('not_started','watching','completed','purchase_only','region_blocked') then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/seasons','code','invalid_status','message','Season status is not supported.')),'correlationId',null));
    end if;
  end loop;
  if (select count(*) from pg_catalog.jsonb_array_elements(seasons_value)) <> (select count(distinct value->>'number') from pg_catalog.jsonb_array_elements(seasons_value)) then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/seasons','code','duplicate_season_number','message','Season numbers must be unique.')),'correlationId',null));
  end if;

  if tmdb_id_value is not null and exists (select 1 from public.shows where user_id = caller_id and tmdb_id = tmdb_id_value) then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','That TMDB ID is already used by this tracker.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/tmdbId','code','duplicate_tmdb_id','message','TMDB ID must be unique within the tracker.')),'correlationId',null));
  end if;

  show_id_value := pg_catalog.gen_random_uuid(); now_at := pg_catalog.clock_timestamp();
  insert into public.shows (id,user_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision)
  values (show_id_value,caller_id,platform_value,title_value,first_air_date_value,synopsis_value,poster_url_value,tmdb_id_value,tmdb_poster_path_value,now_at,now_at,1);

  for season_item in select value from pg_catalog.jsonb_array_elements(seasons_value) loop
    season_number_value := (season_item->>'number')::integer; season_status_value := (season_item->>'status')::public.season_status;
    insert into public.season_progress (id,show_id,user_id,season_number,status,created_at,updated_at,revision)
    values (pg_catalog.gen_random_uuid(),show_id_value,caller_id,season_number_value,season_status_value,now_at,now_at,1);
  end loop;

  select pg_catalog.jsonb_build_object('id',s.id::text,'legacyId',s.legacy_id,'platform',s.platform,'title',s.title,'firstAirDate',s.first_air_date::text,'synopsis',s.synopsis,'posterUrl',s.poster_url,'tmdbId',s.tmdb_id,'tmdbPosterPath',s.tmdb_poster_path,'createdAt',pg_catalog.to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision::text) into show_json from public.shows s where s.id=show_id_value and s.user_id=caller_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id::text,'showId',p.show_id::text,'number',p.season_number,'status',p.status::text,'createdAt',pg_catalog.to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',p.revision::text) order by p.season_number),'[]'::jsonb) into seasons_json from public.season_progress p where p.show_id=show_id_value and p.user_id=caller_id;
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_create_show','entity','show','entityId',show_id_value::text,'data',pg_catalog.jsonb_build_object('show',show_json,'seasons',seasons_json),'conflict',null,'error',null);
exception
  when unique_violation then
    if tmdb_id_value is not null then
      return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','duplicate_tmdb_id','message','That TMDB ID is already used by this tracker.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/tmdbId','code','duplicate_tmdb_id','message','TMDB ID must be unique within the tracker.')),'correlationId',null));
    end if;
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  when others then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_create_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_create_show(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_create_show(jsonb) from public, anon;
grant execute on function public.tracker_create_show(jsonb) to authenticated;
revoke create on schema public from tracker_api_owner;
revoke tracker_api_owner from postgres;
