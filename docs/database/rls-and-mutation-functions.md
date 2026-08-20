# TV Series Tracker v2.0 — RLS and Mutation-Function Specification

**Status:** Accepted Phase 2.1 baseline  
**Date:** 2026-08-17  
**Authority:** [Supabase database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)

## 1. Purpose

This specification fixes the database role, RLS, browser privilege, function input, and result contracts for v2.0. It is a design contract, not executable SQL.

## 2. Roles and forced-RLS model

| Actor/role | Contract |
|---|---|
| Domain-table owner | The migration/administrative schema owner. It owns `shows`, `season_progress`, and `migration_receipts`; browser functions are not owned by this role. |
| `tracker_api_owner` | Dedicated `NOLOGIN`, non-superuser function-owner role. It must not have `BYPASSRLS`. It owns the seven controlled functions and receives only their exact table/sequence capabilities. |
| `anon` | No private-table privileges and no controlled-function execute grants. |
| `authenticated` | Owner-scoped direct `SELECT` under RLS and explicit execute grants on allowed functions. No direct table `INSERT`, `UPDATE`, or `DELETE`. |
| Service role | Separately authorised administration only. It may bypass RLS but is not the normal migration path and is never required by or shipped to GitHub Pages. |

All three private tables have RLS enabled and forced. A security-definer function executes with `tracker_api_owner` privileges, not the table owner's privileges. Forced RLS remains effective because `tracker_api_owner` neither owns the tables nor has `BYPASSRLS`.

Function execution preserves the caller's request/JWT context. Every function captures `auth.uid()` once before any lookup or mutation, rejects a null value defensively, derives `user_id` from that captured UUID, and repeats it in every ownership predicate. Migration and restore use the same owner boundary; service-role invocation is not the browser workflow.

## 3. Conceptual privilege and RLS matrix

This matrix is normative; executable policies/grants are deferred.

| Table/operation | Target role | Policy rule |
|---|---|---|
| `shows`, `season_progress`: `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| All three tables: `SELECT` | `tracker_api_owner` | `USING (auth.uid() = user_id)` |
| `shows`, `season_progress`: `INSERT` | `tracker_api_owner` | `WITH CHECK (auth.uid() = user_id)` |
| `shows`, `season_progress`: `UPDATE` | `tracker_api_owner` | `USING (auth.uid() = user_id)` and `WITH CHECK (auth.uid() = user_id)` |
| `shows`, `season_progress`: `DELETE` | `tracker_api_owner` | `USING (auth.uid() = user_id)` |
| `migration_receipts`: `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `migration_receipts`: `INSERT`, `UPDATE` | `tracker_api_owner` | Owner-scoped `WITH CHECK` and/or `USING` as applicable; reachable only inside the migration function. Receipt `DELETE` is not granted and has no policy. |

No owner write policy targets `authenticated`. Direct DML is revoked from both browser roles. `tracker_api_owner` is not granted broad schema administration, role management, arbitrary function execution, or access to Auth identities beyond what the controlled functions require.

The role's aggregate table capabilities and each function's allowed use are:

| Function | Permitted underlying capabilities |
|---|---|
| `tracker_create_show` | Owner-scoped `SELECT`/`INSERT` on `shows` and `season_progress`. |
| `tracker_update_show` | Owner-scoped `SELECT`/`UPDATE` on `shows`. |
| `tracker_delete_show` | Owner-scoped `SELECT`/`DELETE` on `shows`; season removal occurs through the declared FK cascade. |
| `tracker_upsert_season` | Owner-scoped `SELECT` on `shows`; owner-scoped `SELECT`/`INSERT`/`UPDATE` on `season_progress`. |
| `tracker_delete_season` | Owner-scoped `SELECT` on `shows`; owner-scoped `SELECT`/`DELETE` on `season_progress`. |
| `tracker_migrate_v1`, `tracker_restore_v2` | Owner-scoped `SELECT`/`INSERT`/`UPDATE`/`DELETE` on both domain tables. `tracker_migrate_v1` may use owner-scoped receipt `SELECT`/`INSERT`/`UPDATE`; `tracker_restore_v2` does not mutate receipts. Neither function may delete a receipt. |

Because PostgreSQL grants attach to the shared owner role, the role receives the least-privilege union of that matrix; each function body is limited to its row operations and is tested accordingly. The current UUID design uses no application sequence, so no sequence grant is required. If implementation introduces a sequence, its exact `USAGE`/`SELECT` need must be reviewed and documented rather than granting all sequences.

## 4. Boundary naming and scalar types

Function JSON inputs and returned records use camelCase. Implementations map explicitly to database snake_case (`showId` → `show_id`, `firstAirDate` → `first_air_date`, `expectedRevision` → a revision predicate). Unknown object keys are validation errors.

| Name | Exact contract |
|---|---|
| `showId` | JSON string containing a canonical UUID. |
| `expectedRevision` | Decimal JSON string matching `^[1-9][0-9]{0,18}$` and numerically no greater than `9223372036854775807`. The string form is mandatory so JavaScript never loses bigint precision. Null is allowed only for create-only season upsert. |
| `seasonNumber` | JSON integer from 1 through 32767. |
| `status` | Exactly `not_started`, `watching`, `completed`, `purchase_only`, or `region_blocked`. |
| `migrationKey` | Trimmed string of 1–100 characters. |
| `mode` | Exactly `keep_cloud`, `replace_cloud`, or `reviewed_merge`. |
| `sourceSchemaVersion` | JSON integer from 1 through 2147483647. `tracker_migrate_v1` requires `1`; `tracker_restore_v2` requires `2`. |
| `sourceChecksum`, `expectedCloudChecksum` | Exactly 64 lowercase hexadecimal characters representing SHA-256. `expectedCloudChecksum` is required for every migration/restore mode, including an agreed canonical empty-cloud digest. |
| `sourcePayload` | For v1 migration, `{ "schemaVersion": 1, "shows": [...] }` using the exact v1 fields in the migration specification. For v2 restore, `{ "schemaVersion": 2, "contractVersion": "2.0.0", "exportedAt": <RFC3339 instant>, "shows": [...] }` using the canonical logical v2 show/season fields in that specification. A v1 bare array is normalized to its object envelope before invocation. The function revalidates all nested fields. |

## 5. Shared input objects

### `showInput`

`tracker_create_show` accepts exactly:

```json
{
  "platform": "Netflix",
  "title": "Example",
  "firstAirDate": "2026-01-02",
  "synopsis": "Description",
  "posterUrl": null,
  "tmdbId": 123,
  "tmdbPosterPath": "/poster.jpg",
  "seasons": [{ "number": 1, "status": "not_started" }]
}
```

`platform` and `title` are required trimmed strings of 1–100 and 1–300 characters. `firstAirDate` is omitted/null or a strict `YYYY-MM-DD` date. `synopsis` is optional, defaults to `""`, and is at most 20,000 characters. `posterUrl` is omitted/null or an absolute HTTP(S) URL up to 2,048 characters. `tmdbId` is omitted/null or an integer from 1 through 2147483647. `tmdbPosterPath` is omitted/null or a leading-slash string up to 255 characters. `seasons` is optional and defaults to `[]`; each entry contains exactly `number` and `status`, with unique numbers.

Normal create rejects `id`, `userId`, `legacyId`, `createdAt`, `updatedAt`, and `revision`. Legacy IDs and imported timestamps are exclusive to validated migration/restore payloads.

### `showPatch`

`showPatch` contains at least one and only these fields: `platform`, `title`, `firstAirDate`, `synopsis`, `posterUrl`, `tmdbId`, `tmdbPosterPath`. Values use the same bounds as `showInput`. Omitted means unchanged. Explicit null is permitted only for `firstAirDate`, `posterUrl`, `tmdbId`, and `tmdbPosterPath`. `platform`, `title`, and `synopsis` cannot be null. Unknown/immutable keys, an empty object, and embedded seasons are validation errors; seasons use season functions.

### `mergeDecisions`

The exact object is:

```json
{
  "decisions": [
    {
      "entityType": "show",
      "sourceIdentity": "legacy:tv-0001",
      "cloudIdentity": "show:550e8400-e29b-41d4-a716-446655440000",
      "action": "apply_local_record",
      "expectedRevision": "3"
    },
    {
      "entityType": "season",
      "sourceIdentity": "legacy:tv-0001/season:1",
      "cloudIdentity": "show:550e8400-e29b-41d4-a716-446655440000/season:1",
      "action": "keep_cloud_season",
      "expectedRevision": null
    }
  ]
}
```

Each decision contains exactly the five shown keys. `entityType` is `show` or `season`. Source identity is `legacy:<legacyId>` or `legacy:<legacyId>/season:<number>` and may be null only when no local record exists. Cloud identity is `show:<UUID>` or `show:<UUID>/season:<number>` and may be null only for a local-only create.

Show actions are `keep_cloud_record`, `apply_local_record`, `create_local_record`, and `delete_cloud_record`. Season actions are `keep_cloud_season`, `apply_local_season`, `create_local_season`, and `delete_cloud_season`. Keep actions require a cloud identity but no revision because they do not mutate it. Create actions require a source identity, null cloud identity, and null revision. Apply/delete actions require both the target cloud identity and its positive inspected `expectedRevision` (apply also requires a source identity).

`mergeDecisions` must be absent or `{ "decisions": [] }` for `keep_cloud` and `replace_cloud`. It is mandatory for `reviewed_merge`, even when its array is empty. Duplicate targets, conflicting actions, type/identity mismatch, unresolved source identities, another owner's cloud identity, missing required revisions, or unreferenced ambiguous conflicts are validation errors. The transaction additionally checks `expectedCloudChecksum`. Local absence never deletes a cloud record in reviewed merge without an explicit delete decision.

## 6. Function signatures

| Function | Exact logical inputs |
|---|---|
| `tracker_create_show` | `showInput` |
| `tracker_update_show` | `showId`, `expectedRevision`, `showPatch` |
| `tracker_delete_show` | `showId`, `expectedRevision` |
| `tracker_upsert_season` | `showId`, `seasonNumber`, `expectedRevision`, `status`; null revision means create-only, positive revision means update-only. |
| `tracker_delete_season` | `showId`, `seasonNumber`, `expectedRevision` |
| `tracker_migrate_v1` | `migrationKey`, `mode`, `sourceSchemaVersion`, `sourcePayload`, `sourceChecksum`, `expectedCloudChecksum`, `mergeDecisions` |
| `tracker_restore_v2` | `mode`, `sourceSchemaVersion`, `sourcePayload`, `sourceChecksum`, `expectedCloudChecksum`, `mergeDecisions` |

## 7. Returned record schemas

`showRecord` contains exactly `id`, `legacyId`, `platform`, `title`, `firstAirDate`, `synopsis`, `posterUrl`, `tmdbId`, `tmdbPosterPath`, `createdAt`, `updatedAt`, and `revision`. IDs are UUID strings; nullable fields are explicit nulls; timestamps are server-returned RFC 3339 instants; revision is the same exact positive decimal-string representation as `expectedRevision`.

`seasonRecord` contains exactly `id`, `showId`, `number`, `status`, `createdAt`, `updatedAt`, and decimal-string `revision`. The browser boundary never returns a caller-selectable `userId`; ownership is the authenticated session.

## 8. Database-function result layer

A successfully invoked function returns this fixed envelope:

```json
{
  "contractVersion": "2.0.0",
  "outcome": "success",
  "operation": "tracker_update_show",
  "entity": "show",
  "entityId": "550e8400-e29b-41d4-a716-446655440000",
  "data": null,
  "conflict": null,
  "error": null
}
```

Database outcomes are only `success`, `conflict`, `validation_error`, `not_found`, and `internal_error`. Top-level keys are always present.

`error` is null or exactly `{ "code": "stable_snake_case_code", "message": "safe message", "fields": [{ "path": "/showPatch/title", "code": "required", "message": "Title is required." }], "correlationId": null }`. Paths use JSON Pointer syntax with RFC 6901 escaping. Validation errors sort fields by path then code. Internal errors set a correlation ID and omit fields/internal SQL details.

Stable top-level error codes are `invalid_input` for `validation_error`, `record_not_found` for `not_found`, and `internal_error` for unexpected failures. `record_not_found` uses the same safe message and empty fields for absent and inaccessible records. `success` and `conflict` have null `error`; conflict detail lives only in `conflict`.

A defensive null `auth.uid()` check may produce internal code `auth_context_missing`; the client normalizes it to `unauthenticated`. Normal anonymous callers cannot reach this check because `anon` has no execute grant.

`conflict` is null or exactly `{ "kind": "revision", "expectedRevision": "2", "currentRevision": "3", "currentRecord": <showRecord-or-seasonRecord>, "expectedCloudChecksum": null, "currentCloudChecksum": null }`. Revision values use decimal strings; create-only season collision has null `expectedRevision`. Migration state conflicts use `kind: "cloud_state"`, null revision fields/record, and both safe checksums. Current records are included only after confirming they belong to the captured caller. Missing/cross-owner identities return `not_found`, null data/conflict, and no record.

## 9. Operation-specific success data

| Operation | `entity` / `entityId` | Exact `data` on success |
|---|---|---|
| `tracker_create_show` | `show` / new show UUID | `{ "show": <showRecord>, "seasons": [<seasonRecord>...] }`, seasons ordered by number. |
| `tracker_update_show` | `show` / show UUID | `{ "show": <showRecord> }` |
| `tracker_delete_show` | `show` / show UUID | `{ "deleted": { "id": <UUID>, "revision": <deleted revision> } }` |
| `tracker_upsert_season` | `season` / season UUID | `{ "created": <boolean>, "season": <seasonRecord> }` |
| `tracker_delete_season` | `season` / season UUID when safely resolved, otherwise logical show/season identity | `{ "deleted": { "id": <UUID>, "showId": <UUID>, "number": <integer>, "revision": <deleted revision> } }` |
| `tracker_migrate_v1` | `migration` / `migrationKey` | `migrationResult` below. Replace/reviewed-merge success has a receipt; keep-cloud has a null receipt because no migration occurred. |
| `tracker_restore_v2` | `restore` / `sourceChecksum` | `migrationResult` below; `receipt` is null because restore does not impersonate a v1 receipt. |

`migrationResult` is exactly:

```json
{
  "mode": "replace_cloud",
  "receipt": { "migrationKey": "localstorage-tvSeriesTrackerData.v1", "sourceSchemaVersion": 1 },
  "sourceChecksum": "<64 lowercase hex>",
  "resultChecksum": "<64 lowercase hex>",
  "shows": { "inserted": 352, "updated": 0, "deleted": 0, "unchanged": 0 },
  "seasons": { "inserted": 1028, "updated": 0, "deleted": 0, "unchanged": 0 },
  "finalTotals": { "shows": 352, "seasons": 1028 },
  "completedAt": "2026-08-17T12:00:00.000Z"
}
```

All eight count values and both totals are non-negative integers. Keep-cloud reports all existing records as unchanged and always returns a null receipt. Exact replacement and reviewed merge report actual transaction effects and their committed migration receipt.

Row-operation conflicts use the common revision conflict with the relevant current owned record. Migration/restore conflicts use the cloud-state form. Deletes return identities and deleted revisions only, never full deleted payloads.

Operation conflict contracts are exact:

| Operation | Permitted conflict shape |
|---|---|
| `tracker_create_show` | No normal `conflict` outcome because it has no inspected row revision. A detected existing positive `tmdbId` collision and a concurrent same-owner/TMDB-ID database unique-constraint race both return the identical safe `validation_error` with code `duplicate_tmdb_id`. Timing must not change the outcome. The normalized error exposes no constraint name, SQL text, database diagnostic, or details of the existing record. |
| `tracker_update_show` | `kind: revision`, requested expected revision, current owned show revision and full `showRecord`. |
| `tracker_delete_show` | Same show revision conflict; no deleted content is returned. |
| `tracker_upsert_season` | Update-only uses the season revision conflict. Create-only collision uses `kind: revision`, null `expectedRevision`, current owned season revision, and full `seasonRecord`. |
| `tracker_delete_season` | Season revision conflict with current owned `seasonRecord`. |
| `tracker_migrate_v1` | `kind: cloud_state`, null revision fields/record, submitted `expectedCloudChecksum`, and current owned cloud checksum. |
| `tracker_restore_v2` | Same cloud-state conflict shape. |

For every row operation, a missing or inaccessible target is `not_found` with no current record. A conflict never exposes a record until owner scope has been proven with the captured caller UUID.

Across all operations, `internal_error` is reserved for genuinely unexpected failures rather than anticipated validation or uniqueness conditions.

## 10. Client operation layer

The repository/client adapter normalizes function envelopes plus gateway/session/authorization failures into `success`, `conflict`, `validation_error`, `unauthenticated`, `forbidden`, `not_found`, or `internal_error`, preserving `contractVersion`, `operation`, `entity`, safe `entityId`, `data`, `conflict`, and `error`.

- `unauthenticated`: missing/expired session or authentication failure before invocation, including defensively detected missing Auth context.
- `forbidden`: an authenticated caller lacks execute permission for the capability. Never use it for row ownership.
- PostgreSQL, PostgREST, or Supabase authorization errors are translated to safe stable codes without raw SQL, role names beyond the public contract, stack traces, or internals.
- Function validation/concurrency/not-found results pass through without changing their semantics.

Normalized adapter error codes are `session_required` for `unauthenticated`, `capability_forbidden` for `forbidden`, and `transport_error` for an otherwise unmapped gateway/network failure normalized as `internal_error`. The adapter may preserve a safe gateway correlation ID but not raw response bodies or SQL diagnostics.

Do not grant `anon` execute merely to return JSON authentication errors.

## 11. Representative fixtures

Create success (`data.show` is abbreviated here only by reference to the exact schema above):

```json
{"contractVersion":"2.0.0","outcome":"success","operation":"tracker_create_show","entity":"show","entityId":"550e8400-e29b-41d4-a716-446655440000","data":{"show":{"id":"550e8400-e29b-41d4-a716-446655440000","legacyId":null,"platform":"Netflix","title":"Example","firstAirDate":null,"synopsis":"","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-08-17T12:00:00.000Z","updatedAt":"2026-08-17T12:00:00.000Z","revision":"1"},"seasons":[]},"conflict":null,"error":null}
```

Revision conflict:

```json
{"contractVersion":"2.0.0","outcome":"conflict","operation":"tracker_update_show","entity":"show","entityId":"550e8400-e29b-41d4-a716-446655440000","data":null,"conflict":{"kind":"revision","expectedRevision":"2","currentRevision":"3","currentRecord":{"id":"550e8400-e29b-41d4-a716-446655440000","legacyId":null,"platform":"Netflix","title":"Newer title","firstAirDate":null,"synopsis":"","posterUrl":null,"tmdbId":null,"tmdbPosterPath":null,"createdAt":"2026-08-17T10:00:00.000Z","updatedAt":"2026-08-17T12:01:00.000Z","revision":"3"},"expectedCloudChecksum":null,"currentCloudChecksum":null},"error":null}
```

Validation failure:

```json
{"contractVersion":"2.0.0","outcome":"validation_error","operation":"tracker_update_show","entity":"show","entityId":"550e8400-e29b-41d4-a716-446655440000","data":null,"conflict":null,"error":{"code":"invalid_input","message":"One or more fields are invalid.","fields":[{"path":"/showPatch/title","code":"null_not_allowed","message":"Title cannot be null."}],"correlationId":null}}
```

Migration success:

```json
{"contractVersion":"2.0.0","outcome":"success","operation":"tracker_migrate_v1","entity":"migration","entityId":"localstorage-tvSeriesTrackerData.v1","data":{"mode":"replace_cloud","receipt":{"migrationKey":"localstorage-tvSeriesTrackerData.v1","sourceSchemaVersion":1},"sourceChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","resultChecksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","shows":{"inserted":352,"updated":0,"deleted":0,"unchanged":0},"seasons":{"inserted":1028,"updated":0,"deleted":0,"unchanged":0},"finalTotals":{"shows":352,"seasons":1028},"completedAt":"2026-08-17T12:00:00.000Z"},"conflict":null,"error":null}
```

Transport-level unauthenticated normalization:

```json
{"contractVersion":"2.0.0","outcome":"unauthenticated","operation":"tracker_create_show","entity":"show","entityId":null,"data":null,"conflict":null,"error":{"code":"session_required","message":"Sign in is required.","fields":[],"correlationId":null}}
```

## 12. Function security, transactions, and logging

Every function uses a fixed safe `search_path`, schema-qualified objects, no caller-controlled dynamic identifiers, and execute revoked from default/broad roles before explicit grants to `authenticated`. `tracker_api_owner` receives least-privilege table/sequence grants only. Functions revalidate all inputs and checksums server-side.

Each call is atomic. Show create with seasons, show delete cascade, migration, and restore commit completely or roll back. Ownership and expected revision/checksum predicates are repeated at mutation time.

Logs may contain operation, outcome, timing, correlation ID, necessary owner UUID, and counts. Do not log tokens, email/provider identity, synopsis, payloads, poster URLs, or TMDB query contents by default.

## 13. Required tests and definition of done

Tests must prove:

- `tracker_api_owner` is `NOLOGIN`, lacks `BYPASSRLS`, owns only the functions, and has no capability beyond explicit grants;
- forced RLS blocks the controlled role when `auth.uid()` identifies another owner;
- the full policy matrix permits only intended owner operations;
- `anon` cannot execute functions and neither browser role can perform direct DML;
- gateway denial becomes normalized `unauthenticated`/`forbidden` without raw internals;
- every scalar/object schema, forbidden key, JSON Pointer error, merge action, duplicate/contradictory decision, and mode rule is enforced;
- pre-detected and deliberately raced same-owner `tmdbId` uniqueness collisions both produce the identical `validation_error`/`duplicate_tmdb_id` envelope without constraint names, SQL diagnostics, or existing-record disclosure;
- server UUID/ownership/timestamps/revisions and immutable `created_at` cannot be forged;
- correct revisions succeed, stale revisions conflict without mutation, and disclosure rules hold;
- all seven success/conflict shapes match fixtures and transactions roll back completely;
- migration/restore enforce owner context, `expectedCloudChecksum`, exact replacement/merge rules, and atomic receipts.

Done requires specification approval, implementation/grant/RLS tests, generated types and client adapters matching these exact contracts, and proof that no privileged credential is present in the browser.

## Related documents

- [Database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [LocalStorage migration](localstorage-migration.md)
- [Initial 352-show import](initial-352-show-import.md)
- [ADR-003](../architecture/decisions/ADR-003-auth-rls-and-rpc-mutation-boundary.md)
- [ADR-005](../architecture/decisions/ADR-005-revision-based-optimistic-concurrency.md)
