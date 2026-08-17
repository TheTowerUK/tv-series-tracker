# ADR-004: LocalStorage Migration and Cloud Receipts

**Status:** Accepted  
**Date:** 2026-08-16

## Context

A device snapshot may contain additions, edits, and deletions relative to the packaged baseline. A local completion marker cannot tell another device whether the cloud tracker was migrated.

## Decision

Phase 2.4 builds and validates migration infrastructure with test identities. Phase 2.5 authenticates the real user, checks private `migration_receipts`, and offers keep-cloud, exact-replace, or reviewed-merge behaviour.

Replacement is transactional and exact; merge preserves absent cloud rows unless deletion is explicitly approved. Replace and reviewed-merge write a receipt only after canonical SHA-256 verification and successful commit.

Keep-cloud changes nothing and writes no migration receipt because no migration occurred. The local marker remains non-authoritative UX state.

## Alternatives considered

- Blind baseline/local merge: rejected because deletions and intentional edits would be lost.
- Row-count migration detection: rejected because equal counts do not imply equivalent data.
- Local-only marker: rejected because it does not synchronize across devices.

## Consequences

Migration requires canonical checksums, dry-run reporting, an explicit choice when cloud data exists, atomic verification, and receipt lifecycle rules.

## Security/privacy implications

Import begins only after authentication, derives ownership, uploads only tracker fields, and keeps receipts private. Reports and logs avoid complete private payloads.

## Migration/compatibility implications

Both current LocalStorage envelopes are accepted. Nested TMDB metadata and supported aliases are validated. LocalStorage remains a rollback copy until verified success and export.

## Affected specifications

- [LocalStorage migration](../../database/localstorage-migration.md)
- [Initial import](../../database/initial-352-show-import.md)
- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [Roadmap](../../roadmap/v2.0-plan.md)
