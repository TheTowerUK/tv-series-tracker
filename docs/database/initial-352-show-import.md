# TV Series Tracker v2.0 — Initial 352-Show Import Specification

**Status:** Accepted Phase 2.1 baseline  
**Date:** 2026-08-16  
**Authority:** [Supabase database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)

## 1. Authoritative source and verified facts

`data/shows.json` is the reviewable baseline source. `data/shows.js` is the browser-loadable `window.TV_TRACKER_BASELINE` wrapper and must remain semantically identical. Repository verification on 2026-08-16 established:

| Check | Result |
|---|---:|
| Schema version | 1 |
| Shows | 352 |
| Season rows | 1,028 |
| Maximum populated season | 17 |
| Duplicate IDs/title groups | 0 / 0 |
| Blank title/platform/description | 0 / 0 / 0 |
| Non-sequential season lists | 0 |
| Baseline TMDB objects/non-blank posters | 0 / 0 |
| JSON/JavaScript semantic equality | Pass |

Status counts are `Completed` 627, `Not Started` 349, `Watching` 33, `Purchase Only` 12, and `Region Blocked` 7. Platform counts are Netflix 245, Prime Video 66, BBC iPlayer 20, Disney+ 9, TV 7, and NOW 5.

The baseline file SHA-256 values are evidence about the current files, not migration logical checksums: JSON `3e52311bf9a1948386959169cb3522463fc409259c01bc3ae3e68e6b35f22585`; JavaScript wrapper `481266d7e7665731dd93ffa910d9038a41b99841b3db35bc2276c1a6cb57bf4e`.

## 2. Normalization and mappings

The six current platform values are already normalized. Import preserves them exactly after trimming; it does not infer or rename future free-text platforms. Historical normalization evidence is in the repository `MIGRATION_REPORT.md` (`Amazon` → `Prime Video`, `BBC` → `BBC iPlayer`, `DisneyPlus` → `Disney+`, `Now TV` → `NOW`).

Each `tv-####` ID becomes `shows.legacy_id` and is the show idempotency key with owner: `(user_id, legacy_id)`. Cloud UUIDs are server-generated. Show mappings are `platform`, `title`, `firstAirDate` → `first_air_date`, `description` → `synopsis`, `posterUrl` → `poster_url`, and validated timestamps. Seasons map by `(show_id, season_number)` and the five exact status mappings in the [migration specification](localstorage-migration.md).

Optional current-client metadata maps `tmdb.id` and `tmdb.posterPath` to `tmdb_id` and `tmdb_poster_path`; aliases and contradictions follow the migration specification. Poster URL remains independent. The packaged baseline currently contains neither TMDB objects nor non-blank poster URLs, but the importer must support them for LocalStorage snapshots.

## 3. Validation pipeline and dry run

Validation stages are: envelope/schema; required show shape; stable unique legacy IDs; scalar bounds and trimming; strict dates/timestamps/URLs; TMDB nested/alias consistency; season number uniqueness/range; known statuses; cross-record duplicate detection; canonicalization; and source checksum.

Dry-run output includes source identity and file evidence, schema version, show/season totals, status/platform counts, maximum season, insert/update/delete projections by mode, absent/shortened-season effects, warnings, and every rejected row with stable source ID, field path, safe error code, and message. It must not print secrets or persist the full private payload in operational logs. Any rejection blocks the atomic import; rejected rows are never silently dropped.

## 4. Controlled test-identity workflow

Phase 2.4 creates or uses isolated controlled test identities, loads no production account data, validates the packaged snapshot, records the dry run, executes through the controlled migration boundary, and queries back only the test owner's logical tracker. Tests repeat the import and exercise an exact replacement after deliberate extra/missing rows. Test identities must prove mutual isolation and be handled under the environment's cleanup procedure.

Real users are not migrated until Phase 2.5 Auth/session establishment and receipt inspection.

## 5. Transaction, idempotency, replacement, and retry

The transactional import validates its declared source checksum, derives the owner, upserts shows on `(user_id, legacy_id)`, resolves generated show UUIDs, and upserts seasons on `(show_id, season_number)`. Exact replacement deletes owned shows absent from the snapshot and seasons absent from each included show. It affects no other owner or out-of-scope table.

The transaction re-queries the logical tracker, verifies 352 shows, 1,028 seasons, the five status counts, maximum season 17, and the canonical checksum defined in [LocalStorage migration](localstorage-migration.md). It then writes the receipt. Failure of any stage rolls back writes, deletions, and receipt. Retry with the same migration key/source checksum is idempotent; an existing matching verified receipt returns the recorded success rather than duplicating rows. A different checksum requires a new reviewed execution, not silent receipt replacement.

## 6. Acceptance matrix

| Scenario | Expected result |
|---|---|
| Baseline dry run | 352 shows, 1,028 seasons, no rejected rows, exact measured distributions. |
| First exact import | Verified logical checksum equals source; one private receipt. |
| Same import retry | No duplicates or revision churn; same verified logical result. |
| Extra cloud show/season before replacement | Extra owned tracker rows removed; unrelated scope untouched. |
| Shortened incoming season list | Absent season rows removed in the same transaction. |
| Reviewed merge | Locally absent cloud rows retained unless explicitly approved for deletion. |
| Invalid row/status/TMDB contradiction | Complete rejection report; zero writes and no receipt. |
| Mid-operation failure | Complete rollback; retry remains safe. |
| Cross-owner checks | No read, mutation, receipt, or disclosure across identities. |
| Export then restore | Equivalent canonical logical tracker. |

## 7. Definition of done

The source files remain semantically equal; measured facts are reproducible; validator and checksum fixtures are accepted; dry-run and rejected-row formats are reviewed; controlled test identities pass first import, retry, exact replacement, rollback, privacy, and checksum checks; and evidence is linked from the Phase 2.4 validation record. Phase 2.1 approval accepts this specification but does not authorise production import; implementation and runtime evidence remain Phase 2.4/2.5 gates.

## Related documents

- [Database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [LocalStorage migration](localstorage-migration.md)
- [RLS and mutation functions](rls-and-mutation-functions.md)
- [v2.0 roadmap](../roadmap/v2.0-plan.md)
