# TMDB Edge Function Development Contract

**Status:** Phase 2.7 Step 2 browser integration

**Last updated:** 2026-08-23

The authenticated `tmdb-search-tv` Edge Function is the browser boundary for TMDB television search. The browser invokes it through the existing singleton Supabase client; no committed browser code reads a TMDB credential or calls the TMDB API directly.

## Browser boundary

`js/tmdb-search-service.js` is DOM-free and uses the singleton Supabase client to invoke `tmdb-search-tv` with exactly `contractVersion`, `query`, and `firstAirDate`. It requires an authenticated persisted session, returns only validated candidates to the editor, bounds candidates to eight, and maps function/gateway failures to safe browser outcomes without automatic retry.

The retired `config/tmdb.local.js` and `config/tmdb.example.js` browser-token path must not be recreated. Signed-out users retain the complete local tracker, manual poster URL entry, and image fallback, but TMDB search explains that sign-in is required. Candidate selection still preserves independent `posterUrl` and nested TMDB identity metadata through the existing local or cloud show-save path.

## Local secret configuration

Copy [`../../supabase/functions/.env.example`](../../supabase/functions/.env.example) to `supabase/functions/.env.local` and replace the placeholder locally:

```text
TMDB_API_READ_ACCESS_TOKEN=...
TMDB_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
```

The local file is explicitly ignored. Never commit the token, print it in test output, put it in browser configuration, or use a service-role credential. `TMDB_ALLOWED_ORIGINS` is a comma-separated exact-origin allow-list; do not include paths or use `*`.

Serve locally with the repository-pinned CLI:

```powershell
npx --no-install supabase functions serve --env-file supabase/functions/.env.local
```

JWT verification remains enabled in `supabase/config.toml`. Browser-style requests must include the publishable key in `apikey` and a valid signed-in user token in `Authorization`. The handler also rejects a missing bearer context defensively. Requests without an `Origin` remain available to authenticated non-browser test clients; browser origins must match the allow-list exactly.

## Contract 1.0.0

The function accepts only `POST` JSON:

```json
{
  "contractVersion": "1.0.0",
  "query": "Doctor Who",
  "firstAirDate": "2005-03-26"
}
```

`firstAirDate` is optional or null. The function fixes the upstream endpoint, language `en-GB`, page `1`, and adult-content exclusion. When a date is supplied, it searches with its first-air year; only an empty result triggers one title-only retry. At most eight candidates are returned with exactly `id`, `name`, `firstAirDate`, `posterPath`, and `overview`. The response reports only the requested year, whether fallback was used, and those candidates; it does not echo the query text.

Success and failure always use `contractVersion`, `outcome`, `data`, and `error`. Stable safe error codes are `invalid_request`, `unauthenticated`, `forbidden_origin`, `method_not_allowed`, `rate_limited`, `upstream_unavailable`, `response_invalid`, `configuration_unavailable`, and `internal_error`. TMDB `Retry-After` is normalized to 1–3,600 seconds. Upstream bodies, headers, token values, request JWTs, and diagnostics are never returned or logged.

The function performs no tracker read or mutation, uses no service-role client, stores no queries, and records no analytics. Selection and persistence remain in the browser and the existing ordinary tracker RPC boundary.

## Tests

Run pure mocked-upstream tests with:

```powershell
npm run test:tmdb
```

The opt-in integration test expects a running local function plus local-only environment values. Its live mode creates and removes a disposable local Auth identity, invokes the function through the browser service, and verifies the normalized candidate contract. Local test administration uses the local development secret only to create and clean up that synthetic identity; neither the browser service nor the Edge Function receives it.

## Related documents

- [ADR-006: Server-side TMDB access](../architecture/decisions/ADR-006-server-side-tmdb-access.md)
- [Supabase environment contract](supabase-environments.md)
- [v2.0 roadmap](../roadmap/v2.0-plan.md)
