# ADR-005: Revision-Based Optimistic Concurrency

**Status:** Accepted  
**Date:** 2026-08-17

## Context

Server timestamps can order committed versions but cannot stop a stale client update from becoming the newest write.

## Decision

Mutable domain rows have server-owned positive bigint revisions. Update and delete functions require `expected_revision` and atomically match owner, identity, and revision. Successful updates increment once and set server `updated_at`; zero matched rows is not success. Safe owned conflicts return current state for refresh and user retry/review.

## Alternatives considered

- Timestamp-only last-write-wins: rejected because it does not prevent stale overwrite.
- Database locks held across user interaction: rejected as impractical and unsafe.
- Full event sourcing/merge history: deferred as disproportionate for v2.0.

## Consequences

Clients retain revisions, handle stable conflicts, and never silently retry an unconditional overwrite. Offline mutation queues and automatic merge remain deferred.

## Security/privacy implications

Only an owned current record may appear in a database-function conflict result. Cross-owner and missing identities share `not_found`; gateway permission failures are normalized separately by the client. Clients cannot set stored revisions.

## Migration/compatibility implications

Imports initialise revisions deterministically through the controlled path. JSON logical equivalence excludes revision because it is server concurrency metadata.

## Affected specifications

- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [RLS and mutation functions](../../database/rls-and-mutation-functions.md)
- [LocalStorage migration](../../database/localstorage-migration.md)
