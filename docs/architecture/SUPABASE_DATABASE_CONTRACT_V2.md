# TV Series Tracker v2.0 — Supabase Database Contract

**Status:** Accepted Phase 2.1 baseline for v2.0 implementation  
**Contract version:** 2.0.0  
**Last updated:** 2026-08-17  
**Owner:** TV Series Tracker maintainers  
**Target:** Supabase Postgres with Supabase Auth

## 1. Purpose and scope

This document is the authoritative database contract for TV Series Tracker v2.0. It moves the existing 352-show catalogue and season-by-season viewing state from device-only LocalStorage to Supabase so an authenticated user can sync and restore their tracker across devices.

The contract preserves the v1.2 concepts and field meanings:

- platform/channel;
- show title;
- first air or release date;
- synopsis/description;
- total seasons, represented by the number of season rows;
- overall viewing status, derived from season status;
- optional poster URL and optional TMDB artwork references;
- per-season progress; and
- created and updated timestamps.

Application code changes, UI design, TMDB fetching, social features, viewing history, episode-level tracking, subscriptions and analytics are outside this contract. The database must not collect unnecessary personal data.

## 2. Design decisions

1. **Each tracker is private to one authenticated user.** Every mutable domain row carries `user_id`, and Row Level Security (RLS) compares it with `auth.uid()`.
2. **Shows and progress are relational.** A show has zero or more season rows. The season count is derived rather than separately editable, preventing disagreement between `total_seasons` and the actual progress rows.
3. **Overall status is derived.** It follows the current application rules and is not stored as a second source of truth.
4. **Platform remains text in v2.0.** The current catalogue uses a small canonical set, but free text preserves existing behaviour and avoids coupling user data to a global lookup table.
5. **Revisions enforce optimistic concurrency.** Every mutable domain row has a server-owned `revision`. Normal updates and deletes must present the version they read as `expected_revision`; timestamps order committed versions but do not prevent stale writes.
6. **UUIDs are the database identity.** The current `tv-####` identifiers are retained in `legacy_id` for idempotent migration and traceability.
7. **TMDB is optional metadata.** A show may have a TMDB ID and/or poster path, while `poster_url` continues to support direct artwork URLs and the existing fallback behaviour.
8. **Browser mutations use controlled functions.** Authenticated clients may select their RLS-protected rows directly, but cannot directly insert, update, or delete domain rows. Narrow mutation functions own identity, ownership, timestamps, revisions, validation, and conflict reporting.

## 3. Logical model

```text
auth.users (Supabase-managed)
  1 ─────< shows
  1 ─────< season_progress
  1 ─────< migration_receipts

shows
  1 ─────< season_progress
```

`season_progress.user_id` intentionally duplicates the parent owner. This makes RLS simple and efficient. A composite foreign key ensures it always matches the owner of the referenced show.

`migration_receipts` is private infrastructure state, not an application profile. It records completion of a controlled migration so a newly signed-in device can distinguish an already-migrated cloud tracker from one that still needs import.

## 4. PostgreSQL types

### `season_status`

Create a PostgreSQL enum with these exact database values:

```sql
create type public.season_status as enum (
  'not_started',
  'watching',
  'completed',
  'purchase_only',
  'region_blocked'
);
```

Import/export mappings from v1 are:

| v1 display value | v2 database value |
|---|---|
| `Not Started` | `not_started` |
| `Watching` | `watching` |
| `Completed` | `completed` |
| `Purchase Only` | `purchase_only` |
| `Region Blocked` | `region_blocked` |

## 5. Tables

### 5.1 `public.shows`

One row represents one show in one user's private tracker.

| Column | Type | Null | Default | Contract |
|---|---|---:|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key. Stable cloud identity. |
| `user_id` | `uuid` | no | `auth.uid()` | Owner; foreign key to `auth.users(id)` with `on delete cascade`. Client must not choose another user. |
| `legacy_id` | `text` | yes | — | Original v1 identifier such as `tv-0001`; migration trace only. |
| `platform` | `text` | no | — | Trimmed platform/channel name, 1–100 characters. |
| `title` | `text` | no | — | Trimmed show title, 1–300 characters. |
| `first_air_date` | `date` | yes | — | First air/release date when known. |
| `synopsis` | `text` | no | `''` | Existing `description`; maximum 20,000 characters. Empty is allowed for future user additions. |
| `poster_url` | `text` | yes | — | Optional absolute `http`/`https` artwork URL, maximum 2,048 characters. |
| `tmdb_id` | `integer` | yes | — | Optional positive TMDB TV identifier. |
| `tmdb_poster_path` | `text` | yes | — | Optional TMDB-relative artwork path (for example `/abc.jpg`), maximum 255 characters. |
| `created_at` | `timestamptz` | no | `now()` | Server creation time. |
| `updated_at` | `timestamptz` | no | `now()` | Server-maintained modification time. |
| `revision` | `bigint` | no | `1` | Positive server-owned optimistic-concurrency version; incremented on every successful normal update. |

Required constraints:

```sql
primary key (id)
unique (id, user_id)
unique (user_id, legacy_id)          -- PostgreSQL permits multiple NULL values
check (char_length(btrim(platform)) between 1 and 100)
check (platform = btrim(platform))
check (char_length(btrim(title)) between 1 and 300)
check (title = btrim(title))
check (char_length(synopsis) <= 20000)
check (legacy_id is null or char_length(legacy_id) between 1 and 100)
check (poster_url is null or (
  char_length(poster_url) <= 2048 and poster_url ~* '^https?://'
))
check (tmdb_id is null or tmdb_id > 0)
check (tmdb_poster_path is null or (
  char_length(tmdb_poster_path) <= 255 and tmdb_poster_path ~ '^/'
))
check (revision >= 1)
```

Title is not globally unique and is not unique per user. The existing catalogue currently has no duplicate title groups, but remakes and same-named series are valid. Migration duplicate detection uses `legacy_id`, not title.

### 5.2 `public.season_progress`

One row represents one numbered season and its current viewing state.

| Column | Type | Null | Default | Contract |
|---|---|---:|---|---|
| `id` | `uuid` | no | `gen_random_uuid()` | Primary key. |
| `show_id` | `uuid` | no | — | Parent show. |
| `user_id` | `uuid` | no | `auth.uid()` | Owner, constrained to equal the parent show's owner. |
| `season_number` | `smallint` | no | — | Positive season number. Special season 0 is excluded from v2.0. |
| `status` | `season_status` | no | `'not_started'` | Viewing/access state. |
| `created_at` | `timestamptz` | no | `now()` | Server creation time. |
| `updated_at` | `timestamptz` | no | `now()` | Server-maintained modification time. |
| `revision` | `bigint` | no | `1` | Positive server-owned optimistic-concurrency version; incremented on every successful normal update. |

Required constraints:

```sql
primary key (id)
unique (show_id, season_number)
foreign key (show_id, user_id)
  references public.shows (id, user_id)
  on delete cascade
check (season_number between 1 and 32767)
check (revision >= 1)
```

The current maximum populated season is 17. The wider constraint avoids an arbitrary legacy cap while remaining compatible with `smallint`.

### 5.3 `public.migration_receipts`

One row records successful completion of one versioned migration for one authenticated owner. It is infrastructure state and contains no public profile information.

| Column | Type | Null | Default | Contract |
|---|---|---:|---|---|
| `user_id` | `uuid` | no | — | Owner; foreign key to `auth.users(id)` with `on delete cascade`. |
| `migration_key` | `text` | no | — | Stable source/migration identifier, for example `localstorage-tvSeriesTrackerData.v1`. |
| `source_schema_version` | `integer` | no | — | Validated source schema version. |
| `completed_at` | `timestamptz` | no | `now()` | Server-set successful completion time. |
| `source_checksum` | `text` | no | — | Deterministic checksum of the validated source snapshot. |
| `result_checksum` | `text` | no | — | Deterministic checksum of the resulting cloud tracker representation. |
| `imported_show_count` | `integer` | yes | — | Optional verified resulting show count. |
| `imported_season_count` | `integer` | yes | — | Optional verified resulting season count. |

Required constraints include `primary key (user_id, migration_key)`, non-blank bounded migration/checksum text, positive source schema versions, and non-negative optional counts. The controlled migration path writes or replaces a receipt only after the tracker transaction and deterministic verification succeed. A failed or rolled-back migration must not leave a completion receipt.

The receipt is authoritative cloud migration state. A LocalStorage marker may still suppress redundant device UX, remember a device-specific export, or aid rollback, but it must not be treated as proof that the user's cloud tracker was migrated.

### 5.4 No application profile table in v2.0

Supabase owns authentication records in `auth.users`. The tracker does not require a public profile, name, address, date of birth, phone number, contacts, demographics, location, advertising identifier or behavioural analytics. Email or provider identity, if used for sign-in, remains inside Supabase Auth and is not copied into domain tables.

## 6. Derived fields and status rules

### Total seasons

`total_seasons` is `count(*)` of `season_progress` rows for a show. Do not persist a separate count in v2.0. API queries may return an aggregate count or the client may count the returned season array.

### Overall status

Overall status is calculated from all season statuses, matching v1.2:

1. no season rows → `not_started`;
2. any `watching` → `watching`;
3. every row `completed` → `completed`;
4. at least one `completed` plus `not_started`, `purchase_only`, or `region_blocked` → `partially_watched`;
5. all progress-capable rows `not_started`, with no `completed` → `not_started`;
6. every row either `purchase_only` or `region_blocked` → `unavailable`;
7. otherwise, any `completed` → `partially_watched`;
8. fallback → `not_started`.

The derived API/UI vocabulary is:

`watching`, `partially_watched`, `completed`, `not_started`, `unavailable`.

Do not add this derived vocabulary to `season_status`; season state and overall state are different concepts. If server-side filtering by overall status becomes necessary, add a versioned view or function that implements the rules above rather than adding a manually writable column.

## 7. Indexes

Primary keys, unique constraints and foreign keys do not all create the same access paths. Create these explicit indexes:

```sql
create index shows_user_updated_idx
  on public.shows (user_id, updated_at desc);

create index shows_user_platform_idx
  on public.shows (user_id, platform);

create index shows_user_first_air_date_idx
  on public.shows (user_id, first_air_date desc nulls last);

create index shows_user_title_lower_idx
  on public.shows (user_id, lower(title));

create unique index shows_user_tmdb_id_uidx
  on public.shows (user_id, tmdb_id)
  where tmdb_id is not null;

create index season_progress_user_updated_idx
  on public.season_progress (user_id, updated_at desc);

create index migration_receipts_user_completed_idx
  on public.migration_receipts (user_id, completed_at desc);
```

`unique (show_id, season_number)` supplies the primary season lookup path. Do not add full-text or trigram indexes until measured catalogue/search behaviour justifies the extension and operational cost; 352 shows is small.

## 8. Concurrency, timestamps and mutation behaviour

### Optimistic concurrency

Normal update and delete functions require an `expected_revision` supplied from the record version last read by the client. The function must atomically match all of:

- the authenticated owner derived from `auth.uid()`;
- the row identity; and
- `revision = expected_revision`.

A successful update increments `revision` by exactly one and sets `updated_at` to the database server time. A successful delete removes only the matched revision; deleting a show still cascades its seasons. Zero matched rows is not an ordinary success. The function must distinguish, without disclosing another user's data, between a missing/inaccessible row and a concurrency conflict on an owned row.

For a concurrency conflict, the stable function result must identify the operation and row safely, use a machine-readable result such as `conflict`, and include the current owned server record and current revision where safe. The client must refresh its state and ask the user to retry or review the newer value. It must never silently resubmit stale content as an unconditional overwrite.

Server `updated_at` timestamps order committed versions and support display, export, migration comparison, and reconciliation. They are not the concurrency guard. Offline tombstones, queued offline mutations, and full edit history remain outside v2.0; destructive cloud writes require connectivity.

### Server-owned fields and mutation functions

Authenticated browser clients have no direct `insert`, `update`, or `delete` privilege on `shows`, `season_progress`, or `migration_receipts`. The exact function names, camelCase input schemas, result records, merge decisions, and database/client envelopes are authoritative in the [RLS and mutation-function specification](../database/rls-and-mutation-functions.md).

Normal mutation functions:

- require authentication and derive `user_id` exclusively from `auth.uid()`;
- generate or validate row identities according to the operation;
- set `created_at`, `updated_at`, and initial/incremented `revision` on the server;
- keep `created_at` immutable;
- never accept caller-selected ownership, timestamps, or revisions other than `expected_revision` as a comparison value; and
- return the committed row/version or a stable error/conflict result.

Season creation/upsert resolves ownership through the authenticated parent show and preserves the composite owner foreign key. Updating or deleting an existing season requires its current expected revision; an insert path must not turn a concurrent existing row into an unconditional overwrite. Normal show creation receives a UUID and may leave `legacy_id` null.

Controlled migration/import functions are a separate privileged boundary. They may accept validated legacy `created_at` and `updated_at` only where this contract permits, initialize server-owned revisions deterministically, and perform versioned reconciliation atomically. Browser clients cannot use the normal mutation API to forge imported metadata.

A successfully invoked database function returns only `success`, `conflict`, `validation_error`, `not_found`, or `internal_error`. Missing/cross-owner row identities share `not_found`. The client adapter additionally normalizes session, gateway, and execute-authorization failures into the client outcomes `unauthenticated` and `forbidden` while preserving the common safe envelope. `anon` is not granted execute merely to obtain a JSON authentication result.

## 9. Authentication and RLS

### Assumptions

- Supabase Auth is enabled.
- All domain access occurs as an authenticated user; anonymous users cannot read or mutate cloud tracker data.
- The public client may use the Supabase publishable/anon key. It must never contain a service-role key.
- The service role bypasses RLS and is reserved for separately authorised administration. It is not the normal browser migration/restore path and is never required by the GitHub Pages client.
- A single user owns a tracker in v2.0. Household sharing and collaborative trackers require a later membership model and contract version.

Enable and force RLS on all three private tables:

```sql
alter table public.shows enable row level security;
alter table public.shows force row level security;
alter table public.season_progress enable row level security;
alter table public.season_progress force row level security;
alter table public.migration_receipts enable row level security;
alter table public.migration_receipts force row level security;
```

The migration/administrative schema owner continues to own the domain tables. A dedicated conceptual role named `tracker_api_owner` owns the controlled functions. It must be `NOLOGIN`, non-superuser, and without `BYPASSRLS`; it receives only exact table/sequence capabilities required by those functions. Because it neither owns the forced-RLS tables nor bypasses RLS, its function statements remain subject to RLS.

Apply owner-scoped policies using this predicate:

```sql
(select auth.uid()) = user_id
```

The conceptual policy matrix requires authenticated owner `select` on all private tables; `tracker_api_owner` owner-scoped `select`; owner-scoped `insert` with `with check`; owner-scoped `update` with both `using` and `with check`; and owner-scoped `delete`. Receipt reads are available to authenticated owners, while receipt mutations target only `tracker_api_owner` and remain reachable through controlled functions. Every rule compares `auth.uid()` with `user_id`.

Grant authenticated users RLS-protected `select` and explicitly allowed function execution only. Revoke direct `insert`, `update`, and `delete` on mutable domain and migration-receipt tables from `authenticated` and `anon`; `anon` has no function execution grant. Mutations occur through functions owned by `tracker_api_owner`, and the composite season foreign key remains defence in depth.

Do not expose `auth.users` directly. Function invocation preserves request/JWT context. Every security-definer mutation/import/restore function must capture and validate non-null `auth.uid()` before any lookup, derive and repeatedly predicate ownership with that captured UUID, set a fixed safe `search_path`, schema-qualify objects, and have execute revoked from broad/default roles then explicitly granted. Migration and restore use this same authenticated owner boundary, not normal service-role execution.

Tests must prove `tracker_api_owner` cannot log in or bypass RLS, owns no domain table, has no capability beyond exact grants, and cannot access another owner's row when `auth.uid()` identifies a different owner. They must also prove direct browser DML denial, safe outcome translation, non-forgeable ownership/timestamps/revisions, atomic conflicts, and restricted function execution.

## 10. LocalStorage and baseline migration

### Source contracts

- Baseline catalogue: `data/shows.js` / `data/shows.json`, metadata `schemaVersion: 1`, 352 shows.
- Device override: LocalStorage key `tvSeriesTrackerData.v1` with envelope `{ "schemaVersion": 1, "shows": [...] }` (a bare array is also accepted by the current loader).
- View preference: `tvSeriesTrackerView.v1` is device UI state and must not be migrated to these domain tables.

### Field mapping

| v1 field | v2 destination | Rule |
|---|---|---|
| `id` | `shows.legacy_id` | Preserve exactly; generate cloud UUID separately. |
| `platform` | `shows.platform` | Trim; retain normalized current values. Reject blank. |
| `title` | `shows.title` | Trim; reject blank. |
| `firstAirDate` | `shows.first_air_date` | ISO `YYYY-MM-DD` to `date`; blank becomes `null`. |
| `description` | `shows.synopsis` | Preserve text; missing becomes empty string. |
| `posterUrl` | `shows.poster_url` | Blank becomes `null`; validate HTTP(S). |
| `tmdb.id` | `shows.tmdb_id` | Current application shape; positive integer or `null`. |
| `tmdb.posterPath` | `shows.tmdb_poster_path` | Current application shape; leading-slash TMDB path or `null`. |
| `tmdb.name` | validation/trace only | Current selected TMDB name; not persisted separately in v2.0. |
| `tmdb.firstAirDate` | validation/trace only | Current selected TMDB air date; does not override the user's show `firstAirDate`. |
| `tmdbId`, `tmdbPosterPath` | aliases for the same destinations | Explicitly supported optional top-level aliases for forward/legacy interchange. |
| `createdAt` | `shows.created_at` | Preserve valid timestamp during controlled import. |
| `updatedAt` | `shows.updated_at` | Preserve valid timestamp during controlled import. |
| `seasons[].number` | `season_progress.season_number` | Positive integer; unique within show. |
| `seasons[].status` | `season_progress.status` | Map using the enum table in section 4. |

The current application writes a nested `tmdb` object with `id`, `name`, `firstAirDate`, and `posterPath`. The validator must recognize that real shape. When nested and top-level aliases are both present, the nested fields are canonical only if the corresponding values agree or the alias is absent. Contradictory IDs are an import error that must be reported, not silently resolved. Contradictory poster paths must likewise be reported for review. `posterUrl` is validated and preserved independently regardless of whether TMDB metadata exists.

### One-time migration flow

1. Authenticate the user before uploading any tracker data.
2. Read and validate `tvSeriesTrackerData.v1`. If absent, use the packaged 352-show baseline.
3. Never merge both blindly: the LocalStorage value is a full device snapshot and may include edits, additions, and deletions relative to the baseline.
4. Validate the full payload locally before any write. Report invalid rows; do not silently discard them.
5. Send shows, seasons, reconciliation changes, verification, and the migration receipt through a purpose-built transactional import function. A partially imported tracker is not acceptable.
6. Upsert legacy shows using `(user_id, legacy_id)` and seasons using `(show_id, season_number)`. This makes retrying the same import idempotent.
7. Inspect the authoritative cloud migration receipt after authentication. If migration is incomplete and the cloud tracker already contains data, show an explicit choice: keep cloud, replace cloud from this device, or perform a reviewed merge. Do not guess based only on row counts or a device-local marker.
8. Verify server counts and the canonical SHA-256 source/result checksums before marking migration complete. Sampled record review may supplement diagnosis or human validation but cannot replace deterministic checksum verification.
9. Keep the LocalStorage snapshot as a rollback copy until successful verification and at least one export/download is offered. Do not automatically delete it.
10. Write `migration_receipts` only after a replace or reviewed-merge migration commits and canonical SHA-256 verification succeeds. Keep-cloud makes no tracker change and writes no migration receipt. Also record a local marker for device UX after a completed migration, but treat the cloud receipt as authoritative across devices.

**Replace cloud from this device** means the resulting tracker is an exact cloud representation of the validated source snapshot within one transaction. The operation upserts incoming shows and seasons, removes owned tracker shows absent from the replacement snapshot, and removes season rows absent from each incoming show, including shortened season lists. It must not affect any user other than the authenticated owner or any rows outside this tracker contract. Any write, deletion, canonical SHA-256 verification, or receipt failure rolls back the complete operation. Before commit, verify final show count, season count, and equality of the canonical source and result SHA-256 checksums.

**Reviewed merge** is separate. It reconciles explicitly matched records and does not delete cloud shows or seasons merely because they are absent locally unless the user explicitly approves those deletions as part of the reviewed merge. For conflicting records, compare valid source `updatedAt` with cloud `updated_at` as evidence for review; timestamps do not bypass expected-revision protection or automatically authorize overwrites. If either timestamp is missing or untrusted, require user review. Match legacy records by `legacy_id`, not title. New local records without a stable legacy ID should receive a UUID once and persist that mapping before retry.

The initial 352-show seed is user-owned tracker data after import, not a globally shared mutable catalogue. This preserves current behaviour and prevents one user's edits from affecting another user.

## 11. Backup, restore and deletion

- JSON export remains supported and should include a top-level contract/schema version, export timestamp, shows, and nested seasons.
- Restore uses the same validator and field mappings as LocalStorage migration and runs through a controlled transactional restore/reconciliation function; direct table DML remains unavailable.
- A user can delete individual shows; season rows cascade.
- Account deletion must delete owned shows through `auth.users(id) on delete cascade`, which then deletes season rows.
- Supabase platform backups are operational disaster recovery, not a substitute for user-visible export.
- No soft-delete field is required in v2.0. Adding trash/undo or offline deletion sync requires a later contract revision.

## 12. API shape expectations

The client should read only the authenticated user's rows through RLS and order seasons by `season_number`. A typical logical response is:

```json
{
  "id": "uuid",
  "legacyId": "tv-0001",
  "platform": "Netflix",
  "title": "Unsolved Mysteries",
  "firstAirDate": "1987-01-20",
  "synopsis": "…",
  "posterUrl": null,
  "tmdbId": null,
  "tmdbPosterPath": null,
  "seasons": [
    { "number": 1, "status": "not_started" }
  ],
  "createdAt": "2026-08-15T00:00:00Z",
  "updatedAt": "2026-08-15T00:00:00Z",
  "revision": "1"
}
```

Database snake_case and API/client camelCase may differ, but adapters must be explicit and tested. Clients must not treat client-generated totals or overall status as writable database fields.

## 13. Versioning and ownership

This document uses semantic contract versions:

- **Patch** (`2.0.x`): clarification or compatible constraint/index/policy correction with no client data-shape change.
- **Minor** (`2.x.0`): backward-compatible additive column, table, view, enum strategy, or API capability.
- **Major** (`x.0.0`): breaking rename/removal, changed ownership model, incompatible meaning, or required client migration.

Every schema change must be delivered as an ordered, reviewed Supabase migration in source control. Never edit production schema only through the dashboard. The migration filename should include a UTC timestamp and concise purpose. Update this contract in the same change when behaviour or shape changes.

The TV Series Tracker maintainers own the contract. Database migrations, generated TypeScript types (if used), import/export schema, validation, RLS tests and application adapters must agree with it. A change is not complete until those artefacts and rollback/forward-migration notes are updated.

## 14. Acceptance checks

Before v2.0 is released, automated or repeatable checks must prove that:

- all 352 baseline shows and their season rows import without loss;
- a second execution of the same import creates no duplicates;
- title, platform, dates, synopsis, timestamps, poster fields and every season status round-trip correctly;
- total seasons equals the number of imported season rows;
- derived overall statuses match the v1.2 implementation for representative and edge-case combinations;
- User A cannot select, insert, update, delete, or attach seasons to User B's data;
- anonymous requests cannot access domain rows;
- deleting a show deletes its seasons and deleting an auth user deletes all owned domain data;
- invalid URLs, blank titles/platforms, duplicate season numbers and unknown status values fail cleanly;
- multi-device reads observe committed changes and stale clients do not overwrite newer rows without the documented conflict rule; and
- normal authenticated clients cannot perform direct domain DML or forge ownership, timestamps, or revisions through mutation functions;
- expected-revision update/delete conflicts return a stable conflict result and do not change the current row;
- replacement produces an exact verified snapshot while reviewed merge preserves unapproved absent cloud rows;
- a migration receipt is written only with a successful verified import and is private to its owner; and
- export followed by restore produces an equivalent tracker.

## 15. Deferred decisions

The following require a later contract rather than ad-hoc columns:

- shared/household trackers and invitations;
- episode-level progress, watch dates or ratings;
- multiple platforms per show or regional availability history;
- canonical shared show metadata distinct from a user's tracker entry;
- TMDB synchronization jobs, attribution/configuration, image caching or Supabase Storage;
- offline mutation queues, tombstones, automatic conflict merging and conflict history;
- soft deletion, audit logs or analytics; and
- server-side materialization of derived overall status.
