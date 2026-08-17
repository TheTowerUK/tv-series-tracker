# ADR-003: Auth, RLS, and RPC Mutation Boundary

**Status:** Accepted  
**Date:** 2026-08-17

## Context

RLS protects row visibility but direct browser DML would allow clients to attempt ownership, timestamp, and revision manipulation and would duplicate concurrency logic.

## Decision

Authenticated browsers receive owner-scoped `SELECT` and explicit function execution only. Direct `INSERT`, `UPDATE`, and `DELETE` are revoked, and `anon` receives neither private-table access nor function execution.

Domain tables remain owned by the migration/administrative schema owner. A dedicated `NOLOGIN` function-owner role, `tracker_api_owner`, owns the controlled functions, does not own the tables, has no `BYPASSRLS`, and receives only exact required table/sequence privileges. Forced RLS therefore remains effective inside security-definer functions. Owner-scoped policies target this role for required reads/writes and use the caller's preserved request context. Each function captures non-null `auth.uid()` before lookup, derives `user_id`, and repeats the captured UUID in mutation predicates. Migration and restore use the same boundary; the service role is reserved for separate administration.

Successfully invoked functions return database outcomes (`success`, `conflict`, `validation_error`, `not_found`, `internal_error`). The client adapter preserves the common envelope and adds normalized transport/session outcomes (`unauthenticated`, `forbidden`). Cross-owner row access remains `not_found`, never `forbidden`.

## Alternatives considered

- Direct RLS-protected CRUD: rejected because server-owned metadata and uniform conflict behaviour are harder to guarantee.
- General-purpose mutation RPC: rejected because broad payloads and capabilities weaken reviewability.
- Backend server for every call: unnecessary for v2.0 when tightly scoped database functions provide the boundary.

## Consequences

Function signatures, exact JSON schemas, merge actions, record shapes, and the two-layer result model become a versioned application API and require grants, negative tests, generated types/adapters, and transaction documentation.

## Security/privacy implications

Functions require captured non-null `auth.uid()`, fixed safe `search_path`, schema-qualified objects, restricted execute grants, safe conflict disclosure, and non-sensitive logs. Tests must prove `tracker_api_owner` is non-login/non-bypass, least-privilege, and blocked by forced RLS for another owner. Service-role credentials remain server-only and unnecessary to the browser.

## Migration/compatibility implications

The browser data layer must move from LocalStorage writes to the named controlled functions. Import/restore functions are separate from ordinary mutations and may preserve validated legacy timestamps.

## Affected specifications

- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [RLS and mutation functions](../../database/rls-and-mutation-functions.md)
- [ADR-005](ADR-005-revision-based-optimistic-concurrency.md)
