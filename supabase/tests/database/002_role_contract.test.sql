begin;

select plan(11);

select ok(exists (select 1 from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner exists');
select ok(not (select rolcanlogin from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOLOGIN');
select ok(not (select rolsuper from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is not a superuser');
select ok(not (select rolcreatedb from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOCREATEDB');
select ok(not (select rolcreaterole from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOCREATEROLE');
select ok(not (select rolinherit from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOINHERIT');
select ok(not (select rolreplication from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOREPLICATION');
select ok(not (select rolbypassrls from pg_catalog.pg_roles where rolname = 'tracker_api_owner'), 'tracker_api_owner is NOBYPASSRLS');
select ok(pg_catalog.has_schema_privilege('tracker_api_owner', 'public', 'USAGE'), 'tracker_api_owner has public schema usage');
select ok(not pg_catalog.has_schema_privilege('tracker_api_owner', 'public', 'CREATE'), 'tracker_api_owner cannot create in public schema');
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where r.rolname = 'tracker_api_owner'
      and c.oid in (
        'public.shows'::pg_catalog.regclass,
        'public.season_progress'::pg_catalog.regclass,
        'public.migration_receipts'::pg_catalog.regclass
      )
  ),
  0,
  'tracker_api_owner owns no domain table'
);

select * from finish();
rollback;
