begin;

select plan(19);

select has_schema('tracker_private', 'private tracker helper schema exists');
select is((select nspowner::pg_catalog.regrole::text from pg_catalog.pg_namespace where nspname='tracker_private'),'postgres','administrative role owns private schema');
select ok(has_schema_privilege('tracker_api_owner','tracker_private','USAGE'),'tracker_api_owner can use private schema');
select ok(not has_schema_privilege('tracker_api_owner','tracker_private','CREATE'),'tracker_api_owner cannot create private objects');
select ok(not has_schema_privilege('authenticated','tracker_private','USAGE'),'authenticated cannot use private schema');
select ok(not has_schema_privilege('anon','tracker_private','USAGE'),'anon cannot use private schema');
select ok(not has_schema_privilege('public','tracker_private','USAGE'),'PUBLIC cannot use private schema');

select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='tracker_private.canonical_tracker_text(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','canonical text helper has restricted owner');
select is((select proowner::pg_catalog.regrole::text from pg_catalog.pg_proc where oid='tracker_private.canonical_tracker_sha256(jsonb)'::pg_catalog.regprocedure),'tracker_api_owner','checksum helper has restricted owner');
select ok(not (select prosecdef from pg_catalog.pg_proc where oid='tracker_private.canonical_tracker_text(jsonb)'::pg_catalog.regprocedure),'canonical text helper is security invoker');
select is((select proconfig from pg_catalog.pg_proc where oid='tracker_private.canonical_tracker_text(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'canonical text helper has empty search path');
select is((select proconfig from pg_catalog.pg_proc where oid='tracker_private.canonical_tracker_sha256(jsonb)'::pg_catalog.regprocedure),array['search_path=""'],'checksum helper has empty search path');
select ok(not has_function_privilege('authenticated','tracker_private.canonical_tracker_text(jsonb)','EXECUTE'),'authenticated cannot execute canonical helper');
select ok(not has_function_privilege('anon','tracker_private.canonical_tracker_sha256(jsonb)','EXECUTE'),'anon cannot execute checksum helper');

grant tracker_api_owner to postgres;
set local role tracker_api_owner;

select is(
  tracker_private.canonical_tracker_text('{"schemaVersion":2,"shows":[]}'::jsonb),
  '{"schemaVersion":2,"shows":[]}',
  'empty tracker has exact root key order and no whitespace'
);
select is(
  tracker_private.canonical_tracker_sha256('{"schemaVersion":2,"shows":[]}'::jsonb),
  'c1885444fe79edb7a4d1074af7b69e4a7d5264274b53bea29f00e6438b5c120c',
  'empty tracker has fixed UTF-8 SHA-256 digest'
);

create temporary table checksum_fixture(canonical_text text not null);
insert into checksum_fixture
select tracker_private.canonical_tracker_text($json$
{
  "shows": [
    {
      "identity": "legacy:zeta",
      "legacyId": "zeta",
      "platform": "TV",
      "title": "Quote \" slash \\ café ☃",
      "firstAirDate": null,
      "synopsis": "Line\nTwo",
      "posterUrl": null,
      "tmdbId": null,
      "tmdbPosterPath": null,
      "createdAt": "2026-08-19T13:14:15.006+01:00",
      "updatedAt": "2026-08-19T12:14:15.999Z",
      "seasons": [
        {"status":"completed","number":10},
        {"status":"watching","number":2}
      ]
    },
    {
      "identity": "legacy:alpha",
      "legacyId": "alpha",
      "platform": "Netflix",
      "title": "Alpha",
      "firstAirDate": "2020-01-02",
      "synopsis": "",
      "posterUrl": "https://example.invalid/p.jpg",
      "tmdbId": 42,
      "tmdbPosterPath": "/p.jpg",
      "createdAt": "2020-01-02T03:04:05Z",
      "updatedAt": "2020-01-02T03:04:05.1234Z",
      "seasons": []
    }
  ],
  "schemaVersion": 2
}
$json$::jsonb);

select is(
  (select canonical_text from checksum_fixture),
  E'{"schemaVersion":2,"shows":[{"identity":"legacy:alpha","legacyId":"alpha","platform":"Netflix","title":"Alpha","firstAirDate":"2020-01-02","synopsis":"","posterUrl":"https://example.invalid/p.jpg","tmdbId":42,"tmdbPosterPath":"/p.jpg","createdAt":"2020-01-02T03:04:05.000Z","updatedAt":"2020-01-02T03:04:05.123Z","seasons":[]},{"identity":"legacy:zeta","legacyId":"zeta","platform":"TV","title":"Quote \\" slash \\\\ café ☃","firstAirDate":null,"synopsis":"Line\\nTwo","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-08-19T12:14:15.006Z","updatedAt":"2026-08-19T12:14:15.999Z","seasons":[{"number":2,"status":"watching"},{"number":10,"status":"completed"}]}]}',
  'canonical text fixes keys, show/season order, nulls, escaping, Unicode, dates, and UTC milliseconds'
);
select ok((select canonical_text like '%café ☃%' from checksum_fixture),'Unicode code points are preserved without ASCII escaping or normalization');
select ok(pg_catalog.strpos((select canonical_text from checksum_fixture),pg_catalog.chr(10)) = 0,'canonical document contains no literal whitespace newline');

reset role;

select * from finish();
rollback;
