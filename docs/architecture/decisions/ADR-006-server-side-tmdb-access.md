# ADR-006: Server-Side TMDB Access

**Status:** Accepted  
**Date:** 2026-08-16

## Context

The current local test reads a TMDB token from ignored browser configuration and calls TMDB directly. A public GitHub Pages deployment cannot keep a TMDB secret in client code.

## Decision

Production v2.0 TMDB search/enrichment uses a Supabase Edge Function. The token is stored server-side. The function applies authentication as required, input validation, controlled CORS, bounded results, safe errors, and basic abuse controls. The tracker persists optional TMDB ID/poster path and independent poster URL; automated synchronization is deferred.

## Alternatives considered

- Embed the token in GitHub Pages: rejected because it exposes the secret.
- Remove TMDB lookup: possible but would discard an existing planned capability.
- Direct anonymous proxy with unrestricted queries: rejected because it invites abuse and cost.

## Consequences

TMDB becomes the only v2.0 Edge Function dependency. Deployment requires secret configuration, function monitoring, attribution/configuration review, and resilient no-artwork behaviour.

## Security/privacy implications

No TMDB or privileged Supabase secret reaches the browser. Query logs are bounded and should not become behavioural analytics. Only necessary search input is sent to TMDB.

## Migration/compatibility implications

Migration preserves current nested `tmdb.id`/`tmdb.posterPath` and `posterUrl`. Existing local test configuration is not a production credential path.

## Affected specifications

- [Database contract](../SUPABASE_DATABASE_CONTRACT_V2.md)
- [Roadmap](../../roadmap/v2.0-plan.md)
- [LocalStorage migration](../../database/localstorage-migration.md)
