# ADR-002: Private User-Owned Trackers

**Status:** Accepted  
**Date:** 2026-08-16

## Context

The catalogue and progress are presently one person's mutable tracker. A global catalogue or household model would require different ownership, membership, and metadata rules.

## Decision

Each authenticated user owns private `shows`, `season_progress`, and `migration_receipts` rows. Supabase Auth supplies identity; RLS filters by `auth.uid()`. `season_progress.user_id` duplicates the parent owner and a composite foreign key enforces equality. No application profile table or unnecessary personal information is introduced.

## Alternatives considered

- Shared canonical shows with user progress: deferred because it changes edit semantics and requires catalogue governance.
- Household tracker membership: deferred because invitations and roles need a new contract.
- Public profiles: rejected because v2.0 does not need them.

## Consequences

The initial 352 shows are copied into each importing owner's tracker. Same-titled shows are valid. Sharing and global metadata deduplication require later contract versions.

## Security/privacy implications

Anonymous and cross-owner access are denied. Auth identity is not copied into public profile fields. Account deletion cascades private tracker and receipt data.

## Migration/compatibility implications

Legacy IDs are unique per owner, not globally. Import tooling derives the owner from authentication and must prove isolation with multiple test identities.

## Affected specifications

- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [RLS and mutation functions](../../database/rls-and-mutation-functions.md)
- [Initial import](../../database/initial-352-show-import.md)
