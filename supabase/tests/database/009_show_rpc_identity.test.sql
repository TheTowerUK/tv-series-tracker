begin;

select plan(12);

insert into auth.users (id, email)
values
  ('70000000-0000-0000-0000-000000000007', 'identity-primary@example.invalid'),
  ('80000000-0000-0000-0000-000000000008', 'identity-fallback@example.invalid'),
  ('90000000-0000-0000-0000-000000000009', 'identity-injection@example.invalid');

create temporary table identity_results (
  name text primary key,
  result jsonb not null
);

select pg_catalog.set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000007', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000008"}', true);
insert into identity_results
values ('primary', public.tracker_create_show('{"platform":"Test","title":"Primary identity"}'::jsonb));
select is((select result->>'outcome' from identity_results where name = 'primary'), 'success', 'primary JWT sub authenticates the call');
select is(
  (select user_id from public.shows where id = (select (result->>'entityId')::uuid from identity_results where name = 'primary')),
  '70000000-0000-0000-0000-000000000007'::uuid,
  'request.jwt.claim.sub takes precedence and becomes the owner'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000008"}', true);
insert into identity_results
values ('fallback', public.tracker_create_show('{"platform":"Test","title":"Fallback identity"}'::jsonb));
select is((select result->>'outcome' from identity_results where name = 'fallback'), 'success', 'JSON claims fallback authenticates the call');
select is(
  (select user_id from public.shows where id = (select (result->>'entityId')::uuid from identity_results where name = 'fallback')),
  '80000000-0000-0000-0000-000000000008'::uuid,
  'request.jwt.claims sub becomes the owner when the primary claim is empty'
);

select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select pg_catalog.set_config('request.jwt.claims', '', true);
insert into identity_results
values ('missing', public.tracker_create_show('{"platform":"Test","title":"Missing identity"}'::jsonb));
select is((select result->>'outcome' from identity_results where name = 'missing'), 'internal_error', 'missing claims return the accepted invoked-function outcome');
select is((select result#>>'{error,code}' from identity_results where name = 'missing'), 'auth_context_missing', 'missing claims return stable auth_context_missing');
select is((select result#>>'{error,message}' from identity_results where name = 'missing'), 'The authenticated request context is unavailable.', 'missing claims return a safe authentication message');

select pg_catalog.set_config('request.jwt.claim.sub', 'not-a-uuid', true);
select pg_catalog.set_config('request.jwt.claims', '', true);
insert into identity_results
values ('malformed', public.tracker_create_show('{"platform":"Test","title":"Malformed identity"}'::jsonb));
select is((select result->>'outcome' from identity_results where name = 'malformed'), 'internal_error', 'malformed UUID claim is caught safely');
select is((select result#>>'{error,message}' from identity_results where name = 'malformed'), 'The operation could not be completed.', 'malformed UUID claim exposes only the generic internal message');
select ok(
  (select result::text !~* '(invalid input syntax|uuid|sqlstate|constraint|detail|hint)' from identity_results where name = 'malformed'),
  'malformed claim exposes no SQL or database diagnostics'
);

select pg_catalog.set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000007', true);
insert into identity_results
values (
  'injection',
  public.tracker_create_show(
    '{"platform":"Test","title":"Injected owner","userId":"90000000-0000-0000-0000-000000000009"}'::jsonb
  )
);
select is((select result#>>'{error,fields,0,code}' from identity_results where name = 'injection'), 'unknown_field', 'request JSON ownership field is rejected');
select is(
  (select count(*) from public.shows where user_id = '90000000-0000-0000-0000-000000000009'),
  0::bigint,
  'request JSON cannot create a row for another owner'
);

select * from finish();
rollback;
