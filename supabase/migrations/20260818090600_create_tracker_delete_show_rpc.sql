-- Phase 2.3 Step 3: revision-protected show deletion.

grant tracker_api_owner to postgres;
grant create on schema public to tracker_api_owner;

create or replace function public.tracker_delete_show(request jsonb)
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
  current_row public.shows%rowtype;
  deleted_revision bigint;
  unknown_key text;
  correlation_id uuid;
  show_json jsonb;
begin
  begin
    caller_id := caller_claim::uuid;
  exception when invalid_text_representation then
    correlation_id := pg_catalog.gen_random_uuid();
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
  end;
  if caller_id is null then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','auth_context_missing','message','The authenticated request context is unavailable.','fields','[]'::jsonb,'correlationId',null));
  end if;
  if request is null or pg_catalog.jsonb_typeof(request) <> 'object' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','','code','object_required','message','Request must be a JSON object.')),'correlationId',null));
  end if;
  select key into unknown_key from pg_catalog.jsonb_object_keys(request) key where key not in ('showId','expectedRevision') order by key limit 1;
  if unknown_key is not null or (select count(*) from pg_catalog.jsonb_object_keys(request)) <> 2 or not request ?& array['showId','expectedRevision'] then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path',case when unknown_key is null then '' else '/'||unknown_key end,'code',case when unknown_key is null then 'invalid_request_shape' else 'unknown_field' end,'message','Request must contain exactly showId and expectedRevision.')),'correlationId',null));
  end if;
  if pg_catalog.jsonb_typeof(request->'showId') <> 'string' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/showId','code','invalid_uuid','message','Show ID must be a UUID string.')),'correlationId',null));
  end if;
  begin show_id_value := (request->>'showId')::uuid; exception when invalid_text_representation then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',null,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/showId','code','invalid_uuid','message','Show ID must be a UUID string.')),'correlationId',null));
  end;
  if pg_catalog.jsonb_typeof(request->'expectedRevision') <> 'string' or request->>'expectedRevision' !~ '^[1-9][0-9]*$' then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/expectedRevision','code','invalid_revision','message','Expected revision must be a positive decimal string.')),'correlationId',null));
  end if;
  begin expected_revision_value := (request->>'expectedRevision')::bigint; exception when numeric_value_out_of_range then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','validation_error','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','invalid_input','message','One or more fields are invalid.','fields',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path','/expectedRevision','code','invalid_revision','message','Expected revision must be within bigint range.')),'correlationId',null));
  end;

  select * into current_row from public.shows where id=show_id_value and user_id=caller_id;
  if not found then
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','not_found','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','not_found','message','Show was not found.','fields','[]'::jsonb,'correlationId',null));
  end if;
  if current_row.revision <> expected_revision_value then
    select pg_catalog.jsonb_build_object('id',s.id::text,'legacyId',s.legacy_id,'platform',s.platform,'title',s.title,'firstAirDate',s.first_air_date::text,'synopsis',s.synopsis,'posterUrl',s.poster_url,'tmdbId',s.tmdb_id,'tmdbPosterPath',s.tmdb_poster_path,'createdAt',pg_catalog.to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision::text) into show_json from public.shows s where s.id=current_row.id and s.user_id=caller_id;
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','revision','expectedRevision',expected_revision_value::text,'currentRevision',current_row.revision::text,'currentRecord',show_json,'expectedCloudChecksum',null,'currentCloudChecksum',null),'error',null);
  end if;

  delete from public.shows where id=show_id_value and user_id=caller_id and revision=expected_revision_value returning revision into deleted_revision;
  if not found then
    select * into current_row from public.shows where id=show_id_value and user_id=caller_id;
    if not found then return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','not_found','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','not_found','message','Show was not found.','fields','[]'::jsonb,'correlationId',null)); end if;
    select pg_catalog.jsonb_build_object('id',s.id::text,'legacyId',s.legacy_id,'platform',s.platform,'title',s.title,'firstAirDate',s.first_air_date::text,'synopsis',s.synopsis,'posterUrl',s.poster_url,'tmdbId',s.tmdb_id,'tmdbPosterPath',s.tmdb_poster_path,'createdAt',pg_catalog.to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',pg_catalog.to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revision',s.revision::text) into show_json from public.shows s where s.id=current_row.id and s.user_id=caller_id;
    return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','conflict','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',null,'conflict',pg_catalog.jsonb_build_object('kind','revision','expectedRevision',expected_revision_value::text,'currentRevision',current_row.revision::text,'currentRecord',show_json,'expectedCloudChecksum',null,'currentCloudChecksum',null),'error',null);
  end if;
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','success','operation','tracker_delete_show','entity','show','entityId',show_id_value::text,'data',pg_catalog.jsonb_build_object('deleted',pg_catalog.jsonb_build_object('id',show_id_value::text,'revision',deleted_revision::text)),'conflict',null,'error',null);
exception when others then
  correlation_id:=pg_catalog.gen_random_uuid();
  return pg_catalog.jsonb_build_object('contractVersion','2.0.0','outcome','internal_error','operation','tracker_delete_show','entity','show','entityId',case when show_id_value is null then null else show_id_value::text end,'data',null,'conflict',null,'error',pg_catalog.jsonb_build_object('code','internal_error','message','The operation could not be completed.','fields','[]'::jsonb,'correlationId',correlation_id::text));
end;
$$;

alter function public.tracker_delete_show(jsonb) owner to tracker_api_owner;
revoke all on function public.tracker_delete_show(jsonb) from public, anon;
grant execute on function public.tracker_delete_show(jsonb) to authenticated;
revoke create on schema public from tracker_api_owner;
revoke tracker_api_owner from postgres;
