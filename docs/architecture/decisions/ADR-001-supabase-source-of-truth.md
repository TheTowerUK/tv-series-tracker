# ADR-001: Supabase as the v2.0 Source of Truth

**Status:** Accepted  
**Date:** 2026-08-16

## Context

v1.2 stores a complete tracker snapshot in one browser's LocalStorage. v2.0 must restore and synchronize the private tracker across devices while preserving JSON backup.

## Decision

After a verified Phase 2.5 migration, Supabase Postgres is authoritative for tracker data. LocalStorage becomes a bounded cache, migration source, and rollback copy; JSON remains the user-controlled backup/restore format. Version-controlled migrations implement the authoritative database contract but never replace it.

## Alternatives considered

- Continue device-only LocalStorage: rejected because it cannot provide reliable cross-device state.
- Treat cloud and LocalStorage as equal writable peers: rejected because conflict and deletion semantics would be ambiguous without a later offline-sync design.
- Use a shared global catalogue: rejected for v2.0 because the existing tracker is user-owned and mutable.

## Consequences

Reads and writes require authenticated cloud availability after cutover. Offline mutation queues are deferred. Migration, export, rollback, and cloud-error states must be explicit.

## Security/privacy implications

Only necessary tracker data enters private owner-scoped tables. Supabase credentials are split into browser-safe and privileged classes; no service role is shipped to the client.

## Migration/compatibility implications

The v1 snapshot is validated and transactionally reconciled before cutover. LocalStorage is retained until verification and export. Existing field meanings and five statuses remain compatible.

## Affected specifications

- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [Roadmap](../../roadmap/v2.0-plan.md)
- [LocalStorage migration](../../database/localstorage-migration.md)
- [ADR-004](ADR-004-localstorage-migration-and-cloud-receipts.md)
