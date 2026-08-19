-- Phase 2.4 Step 1: private canonical tracker serialization and SHA-256.

create extension if not exists pgcrypto with schema extensions;

create schema tracker_private authorization postgres;
revoke all on schema tracker_private from public, anon, authenticated, tracker_api_owner;
grant tracker_api_owner to postgres;
grant usage, create on schema tracker_private to tracker_api_owner;
grant usage on schema extensions to tracker_api_owner;
grant execute on function extensions.digest(bytea, text) to tracker_api_owner;

create function tracker_private.canonical_tracker_text(payload jsonb)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  schema_version_text text;
  shows_text text;
begin
  if payload is null
     or pg_catalog.jsonb_typeof(payload) <> 'object'
     or not payload ? 'schemaVersion'
     or pg_catalog.jsonb_typeof(payload -> 'schemaVersion') <> 'number'
     or (payload ->> 'schemaVersion') !~ '^[1-9][0-9]*$'
     or not payload ? 'shows'
     or pg_catalog.jsonb_typeof(payload -> 'shows') <> 'array' then
    raise exception using errcode = '22023', message = 'canonical tracker payload is invalid';
  end if;

  schema_version_text := (payload ->> 'schemaVersion')::integer::text;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(payload -> 'shows') as item(value)
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
       or pg_catalog.jsonb_typeof(item.value -> 'identity') <> 'string'
       or item.value ->> 'identity' = ''
       or pg_catalog.jsonb_typeof(item.value -> 'seasons') <> 'array'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(payload -> 'shows') as item(value)
    group by item.value ->> 'identity'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'canonical tracker shows are invalid';
  end if;

  select coalesce(
    pg_catalog.string_agg(
      '{' ||
      '"identity":' || pg_catalog.to_jsonb(show_item ->> 'identity')::text ||
      ',"legacyId":' || case when show_item -> 'legacyId' is null or show_item -> 'legacyId' = 'null'::jsonb then 'null' else pg_catalog.to_jsonb(show_item ->> 'legacyId')::text end ||
      ',"platform":' || pg_catalog.to_jsonb(show_item ->> 'platform')::text ||
      ',"title":' || pg_catalog.to_jsonb(show_item ->> 'title')::text ||
      ',"firstAirDate":' || case when show_item -> 'firstAirDate' is null or show_item -> 'firstAirDate' = 'null'::jsonb then 'null' else pg_catalog.to_jsonb((show_item ->> 'firstAirDate')::date::text)::text end ||
      ',"synopsis":' || pg_catalog.to_jsonb(show_item ->> 'synopsis')::text ||
      ',"posterUrl":' || case when show_item -> 'posterUrl' is null or show_item -> 'posterUrl' = 'null'::jsonb then 'null' else pg_catalog.to_jsonb(show_item ->> 'posterUrl')::text end ||
      ',"tmdbId":' || case when show_item -> 'tmdbId' is null or show_item -> 'tmdbId' = 'null'::jsonb then 'null' else (show_item ->> 'tmdbId')::integer::text end ||
      ',"tmdbPosterPath":' || case when show_item -> 'tmdbPosterPath' is null or show_item -> 'tmdbPosterPath' = 'null'::jsonb then 'null' else pg_catalog.to_jsonb(show_item ->> 'tmdbPosterPath')::text end ||
      ',"createdAt":' || pg_catalog.to_jsonb(pg_catalog.to_char((show_item ->> 'createdAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text ||
      ',"updatedAt":' || pg_catalog.to_jsonb(pg_catalog.to_char((show_item ->> 'updatedAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text ||
      ',"seasons":[' || coalesce((
        select pg_catalog.string_agg(
          '{"number":' || (season_item ->> 'number')::smallint::text ||
          ',"status":' || pg_catalog.to_jsonb(season_item ->> 'status')::text || '}',
          ',' order by (season_item ->> 'number')::smallint
        )
        from pg_catalog.jsonb_array_elements(show_item -> 'seasons') as season(season_item)
      ), '') || ']}' ,
      ',' order by (show_item ->> 'identity') collate "C"
    ),
    ''
  )
  into shows_text
  from pg_catalog.jsonb_array_elements(payload -> 'shows') as show_row(show_item);

  return '{"schemaVersion":' || schema_version_text || ',"shows":[' || shows_text || ']}';
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'canonical tracker payload is invalid';
end;
$$;

alter function tracker_private.canonical_tracker_text(jsonb) owner to tracker_api_owner;

create function tracker_private.canonical_tracker_sha256(payload jsonb)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(tracker_private.canonical_tracker_text(payload), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

alter function tracker_private.canonical_tracker_sha256(jsonb) owner to tracker_api_owner;

revoke all on function tracker_private.canonical_tracker_text(jsonb) from public, anon, authenticated;
revoke all on function tracker_private.canonical_tracker_sha256(jsonb) from public, anon, authenticated;
grant execute on function tracker_private.canonical_tracker_text(jsonb) to tracker_api_owner;
grant execute on function tracker_private.canonical_tracker_sha256(jsonb) to tracker_api_owner;

revoke create on schema tracker_private from tracker_api_owner;
revoke tracker_api_owner from postgres;
