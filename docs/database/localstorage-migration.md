# TV Series Tracker v2.0 — LocalStorage Migration Specification

**Status:** Accepted Phase 2.1 baseline  
**Date:** 2026-08-17  
**Authority:** [Supabase database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)

## 1. Sources and selection

The domain snapshot key is `tvSeriesTrackerData.v1`. Accepted payloads are `{ "schemaVersion": 1, "shows": [...] }` and the current loader-compatible bare show array. A missing key selects the packaged baseline from `data/shows.js`/`data/shows.json`. An invalid present key is reported; it does not silently fall back to baseline.

The LocalStorage value is a complete device override, not a delta. Never merge it blindly with the baseline. `tvSeriesTrackerView.v1` is device presentation state and is not migrated.

## 2. Mapping and validation

| Source | Destination/rule |
|---|---|
| `id` | `shows.legacy_id`; preserve exactly and require a stable, unique, non-blank value for v1 migration. |
| `platform`, `title` | Trim and validate contract bounds; blank is rejected. |
| `firstAirDate` | Strict `YYYY-MM-DD` calendar date or null when blank. |
| `description` | `synopsis`; missing becomes empty text within contract bounds. |
| `posterUrl` | `poster_url`; blank becomes null; otherwise absolute HTTP(S). |
| `createdAt`, `updatedAt` | Strict RFC 3339 instants; normalize to UTC before canonicalization. Invalid values are reported. |
| `seasons[].number` | Positive unique integer within show. |
| `seasons[].status` | Map using the status table below. |

The current application stores optional TMDB selection as `tmdb.id`, `tmdb.name`, `tmdb.firstAirDate`, and `tmdb.posterPath`. `tmdb.id` maps to `tmdb_id`; `tmdb.posterPath` maps to `tmdb_poster_path`. Name and TMDB air date are validated/retained in the dry-run evidence but are not separate v2 columns and do not override show title/date.

Supported aliases are top-level `tmdbId` and `tmdbPosterPath`. The nested value is canonical only when the alias is absent or equal after type normalization. Contradictory IDs or poster paths reject that record and appear in the report. Missing metadata remains null. `posterUrl` is independent and is never discarded because TMDB metadata is absent.

| v1 status | Database status |
|---|---|
| `Not Started` | `not_started` |
| `Watching` | `watching` |
| `Completed` | `completed` |
| `Purchase Only` | `purchase_only` |
| `Region Blocked` | `region_blocked` |

Unknown statuses are errors. Source timestamps must be valid, and `updatedAt` earlier than `createdAt` is reported for review rather than silently repaired. Only the controlled migration/restore boundary may preserve validated source timestamps.

## 3. Canonical checksum

Both source and result checksums use SHA-256 over UTF-8 without BOM of a canonical, whitespace-free JSON document. Before serialization:

1. Convert to the logical v2 tracker shape and include exactly `schemaVersion`, `shows`, and each show's `identity`, `legacyId`, `platform`, `title`, `firstAirDate`, `synopsis`, `posterUrl`, `tmdbId`, `tmdbPosterPath`, `createdAt`, `updatedAt`, and `seasons`. `identity` is `legacy:` plus the exact legacy ID, or `cloud:` plus the lowercase UUID only for a cloud-native record with no legacy ID.
2. Emit object keys in the exact order listed above; season keys are `number`, then `status`.
3. Emit every nullable field explicitly as JSON `null`; do not omit it. Normalize database status values to the v2 snake-case vocabulary.
4. Sort shows by Unicode code-point order of `identity`; sort seasons numerically by `number`. Reject duplicate stable identities before hashing.
5. Encode dates as `YYYY-MM-DD`; instants as UTC RFC 3339 with exactly three fractional digits and `Z`; integers as base-10 JSON numbers; strings as standard JSON strings without Unicode normalization or locale folding.
6. Exclude generated cloud UUIDs when a legacy identity exists, plus `user_id`, revisions, receipt metadata, and server-only operational fields. A cloud-native UUID appears only inside its required `cloud:` identity.

The lowercase hexadecimal digest is stored as `source_checksum`. After reconciliation, re-query the transactional logical result, canonicalize identically, and store `result_checksum`. Exact replacement requires equal source/result digests. Reviewed merge may legitimately differ and records both digests plus reviewed decisions.

## 4. Phase and authentication ordering

Phase 2.4 builds validators, dry-run reporting, transactional reconciliation, checksum verification, and tests using controlled test identities. Real browser migration does not occur there. Phase 2.5 first establishes minimum Auth/session state, then reads the owner's cloud receipt and tracker state, presents any required decision, executes migration, and only switches reads after success.

The authoritative receipt key for this path is `localstorage-tvSeriesTrackerData.v1` with source schema version `1`. A valid owner receipt prevents repeat prompts across devices. A device-local completion marker improves UX but is not authoritative.

## 5. User choices

- **Keep cloud:** make no tracker changes and create no migration receipt because no migration occurred. The application may remember the dismissed prompt as non-authoritative device UX state, but it must not represent keep-cloud as a completed cloud migration.
- **Replace cloud from this device:** within one transaction, upsert every incoming show and season, delete owned tracker shows absent from the source, delete absent seasons from incoming shows, verify exact counts and equal checksum, and write the receipt. Do not touch other users or data outside tracker scope.
- **Reviewed merge:** apply only decisions shown and approved using the exact `mergeDecisions` identities/actions/revisions in the [mutation-function specification](rls-and-mutation-functions.md#mergedecisions). Absence in the local snapshot never implies deletion. A cloud show/season is deleted only by an explicit reviewed decision. Verify the merged result and record both checksums and decision evidence without storing unnecessary payload content.

Any failure in writes, deletions, verification, or receipt creation rolls back the complete operation.

## 6. Conflicts and recovery

Migration reconciliation receives the canonical checksum of the cloud state inspected for the decision as `expected_cloud_checksum` and compares it again inside the transaction. If that state changes before commit, the operation returns conflict and makes no change. The controlled boundary revalidates the submitted payload and source checksum rather than trusting browser validation. Valid timestamps may inform a proposed merge but never bypass revisions or authorise an overwrite. Missing/untrusted timestamps require review.

On validation failure, show all safe row/field errors and write nothing. On transient failure, retain the source and allow idempotent retry. On ambiguous post-request connectivity, query the receipt and result checksum before retrying. Preserve LocalStorage until verified success and at least one JSON export is offered. Never automatically delete the rollback copy.

JSON restore uses the same canonicalization, validation, exact-replace/reviewed-merge, transaction, and verification principles through `tracker_restore_v2`; it does not impersonate a v1 migration receipt.

## 7. Privacy and security

Authenticate before upload. Derive ownership from `auth.uid()`. Do not send `tvSeriesTrackerView.v1`, tokens, email identity, or unrelated LocalStorage keys. Browser code receives no service-role credential. Reports should identify invalid tracker records without logging complete private snapshots to operational logs.

## 8. Required tests and definition of done

Tests cover both envelopes, missing/invalid storage, baseline selection, all field/status mappings, nested/alias TMDB agreement and contradiction, timestamp edge cases, canonical checksum fixtures, idempotent retry, concurrent cloud change, each user choice, exact season shortening, rollback, receipt atomicity/privacy, and export/restore equivalence.

Done requires accepted fixtures for canonical serialization, complete 352-show verification, atomic import evidence under test identities, successful Phase 2.5 user-flow validation, preserved rollback/export, and no cross-owner or partial state.

## Related documents

- [Database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [RLS and mutation functions](rls-and-mutation-functions.md)
- [Initial 352-show import](initial-352-show-import.md)
- [ADR-004](../architecture/decisions/ADR-004-localstorage-migration-and-cloud-receipts.md)
