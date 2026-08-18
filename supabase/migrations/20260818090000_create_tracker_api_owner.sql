-- Phase 2.3 Step 1: dedicated owner for controlled tracker API functions.
-- This role owns no tables and intentionally has no login or RLS bypass.

do $role$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'tracker_api_owner'
  ) then
    create role tracker_api_owner
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$role$;

do $role_security$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'tracker_api_owner'
      and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'tracker_api_owner has a prohibited privileged attribute';
  end if;
end
$role_security$;

-- The Supabase migration runner has CREATEROLE but is intentionally not a
-- superuser. PostgreSQL permits it to reassert these non-privileged flags;
-- superuser, replication, and BYPASSRLS are validated above instead.
alter role tracker_api_owner
  nologin
  nocreatedb
  nocreaterole
  noinherit;

revoke all on schema public from tracker_api_owner;
grant usage on schema public to tracker_api_owner;
