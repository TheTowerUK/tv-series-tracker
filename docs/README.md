# TV Series Tracker Documentation

## Purpose and status

This directory contains the versioned architecture, security, migration, delivery, and validation documentation for TV Series Tracker v2.0. The Phase 2.1 documentation baseline was accepted on 2026-08-17. Phase 2.2 was approved on 2026-08-18: its local tooling baseline is commit `e8ee931`, and its closure baseline records the approved hosted development-environment disposition, environment contract, browser-safe configuration shape, and reproduced local workflow. Phase 2.3 is next but has not begun. No Supabase schema, function, application integration, or production migration is implied by documentation approval.

TTSPlayer is a separate project. Its files, secrets, infrastructure, and decisions are completely out of scope.

## Source-of-truth hierarchy

When documents disagree, use this order:

1. [Supabase database contract v2.0](architecture/SUPABASE_DATABASE_CONTRACT_V2.md) for data shape, ownership, security invariants, concurrency, and migration semantics.
2. Accepted Architecture Decision Records for the rationale of established architecture choices.
3. Database/security specifications for detailed interface and workflow contracts.
4. [v2.0 roadmap](roadmap/v2.0-plan.md) for sequencing and delivery gates.
5. Phase validation records for evidence and approval status; they do not redefine architecture.

Version-controlled database migrations will implement the contract after approval. Migrations never replace the contract, and schema changes require both to be updated together.

## Architecture

- [Supabase database contract v2.0](architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [ADR-001: Supabase source of truth](architecture/decisions/ADR-001-supabase-source-of-truth.md)
- [ADR-002: Private user-owned trackers](architecture/decisions/ADR-002-private-user-owned-trackers.md)
- [ADR-003: Auth, RLS, and RPC mutation boundary](architecture/decisions/ADR-003-auth-rls-and-rpc-mutation-boundary.md)
- [ADR-004: LocalStorage migration and cloud receipts](architecture/decisions/ADR-004-localstorage-migration-and-cloud-receipts.md)
- [ADR-005: Revision-based optimistic concurrency](architecture/decisions/ADR-005-revision-based-optimistic-concurrency.md)
- [ADR-006: Server-side TMDB access](architecture/decisions/ADR-006-server-side-tmdb-access.md)

## Database and security specifications

- [RLS and mutation functions](database/rls-and-mutation-functions.md)
- [LocalStorage migration](database/localstorage-migration.md)
- [Initial 352-show import](database/initial-352-show-import.md)

## Development environments

- [Supabase environment and configuration contract](development/supabase-environments.md)
- [Browser-safe Supabase configuration example](../config/supabase.example.js)

## Roadmap and validation

- [v2.0 roadmap](roadmap/v2.0-plan.md)
- [Phase 2.1 validation checklist](roadmap/v2.0-phase-2.1-validation.md)
- [Phase 2.2 validation and closure checklist](roadmap/v2.0-phase-2.2-validation.md)

Later phases should add dated validation/evidence records beside the relevant roadmap material rather than rewriting historical results.

## Naming and update expectations

- ADR filenames use `ADR-NNN-short-decision.md`; do not reuse a number or rewrite an accepted decision without recording its supersession.
- Specifications use lowercase kebab-case filenames and state their status, date, and authority.
- Phase validation files use `v2.0-phase-N.N-validation.md` and distinguish repository evidence from human approval.
- Use relative Markdown links within `docs/` and update the index when documents are added, moved, or superseded.
- Update the contract, affected specifications, ADR status/links, roadmap, validation evidence, export schema, and adapters together when behaviour changes.
- Never mark a phase complete solely because draft documents or implementation files exist.
