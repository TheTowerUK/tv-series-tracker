# TV Series Tracker v2.0 — Supabase Environment and Configuration Contract

**Status:** Accepted for the Phase 2.2 baseline

**Date:** 2026-08-18

**Authority:** [Supabase database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md) and [v2.0 roadmap](../roadmap/v2.0-plan.md)

## Purpose and scope

This specification defines how maintainers reproduce, configure, and operate the local Supabase foundation and how future linked environments must be separated. It does not authorize a hosted-project link, deployment, schema implementation, Auth UI, application integration, Edge Function, or data import. Phase 2.3 owns schema, RLS, roles, RPC functions, migrations, and database security tests.

## Toolchain and prerequisites

- Node.js 20 or newer. The validated workstation used Node.js 24.
- Docker Desktop with WSL2, hardware virtualization, Linux containers, and a responding Docker engine.
- The repository-local Supabase CLI. Run `npm ci` after checkout and invoke `npx --no-install supabase`; do not depend on a global CLI.
- `package.json` and `package-lock.json` pin Supabase CLI `2.114.0`. A CLI upgrade is an explicit reviewed dependency change with a fresh start/reset validation.

Confirm the environment before use:

```powershell
docker version
npm ci
npx --no-install supabase --version
```

The version command must report `2.114.0` for this baseline.

## Local workflow

Run all commands from the repository root.

### Start and inspect

```powershell
npm run supabase:start
npm run supabase:status
```

`supabase start` may download container images on first use. `supabase status` prints local-only credentials; treat terminal output and captured logs as sensitive even though those credentials are not valid against a hosted project. The optional local analytics service is disabled because its Docker log collector would otherwise require an insecure Docker TCP endpoint on Windows. Image transformation and the database pooler are also disabled by the generated foundation.

### Reset the local database

```powershell
npx --no-install supabase db reset --local
```

Always spell out `--local`. Reset is destructive to local container data. It must never be used as a production rollback mechanism. In the empty Phase 2.2 foundation, the command may warn that `supabase/seed.sql` is absent; no seed file or data is expected, and a successful reset remains valid.

### Stop

```powershell
npm run supabase:stop
```

Stop the stack when it is no longer needed. The CLI may retain ignored local Docker backup and catalog state for a faster restart.

## Local endpoints

These values come from the committed `supabase/config.toml` and are local-development addresses only.

| Capability | Local endpoint | Notes |
|---|---|---|
| API gateway | `http://127.0.0.1:54321` | Base for Auth, REST, GraphQL, Realtime, Storage, and Functions routes. |
| Auth | `http://127.0.0.1:54321/auth/v1` | Local Auth service; no application Auth integration exists yet. |
| REST | `http://127.0.0.1:54321/rest/v1` | No tracker tables or RPCs exist in Phase 2.2. |
| GraphQL | `http://127.0.0.1:54321/graphql/v1` | Generated platform endpoint; no tracker schema exists yet. |
| Realtime | `http://127.0.0.1:54321/realtime/v1` | Enabled platform service; application synchronization is deferred. |
| Storage | `http://127.0.0.1:54321/storage/v1` | No tracker bucket or artwork storage is defined. |
| Functions | `http://127.0.0.1:54321/functions/v1` | Runtime route only; no Edge Function exists. |
| PostgreSQL | `127.0.0.1:54322` (database `postgres`) | Obtain local credentials from `supabase status` when needed; never copy a database credential into browser configuration or documentation. |
| Studio | `http://127.0.0.1:54323` | Local administration UI. Dashboard experimentation is not a substitute for migrations. |
| Mail viewer | `http://127.0.0.1:54324` | Captures local test email; it does not send production email. |

## Browser-safe configuration

The future GitHub Pages client may receive only the environment's Supabase URL and publishable key (or legacy anon key where the selected hosted project still uses that terminology). These values identify the public Data API and are not privileged credentials; RLS and grants remain mandatory.

The committed example is [`../../config/supabase.example.js`](../../config/supabase.example.js):

```javascript
window.SUPABASE_CONFIG = Object.freeze({
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY"
});
```

The boundary uses camelCase keys:

| Field | Required shape |
|---|---|
| `url` | Absolute HTTPS project URL with no embedded credential, query, or fragment. Local development may use `http://127.0.0.1:54321`. |
| `publishableKey` | Non-blank Supabase publishable key, or the environment's browser-safe anon key during an explicitly reviewed compatibility period. |

Do not add service-role/secret keys, database URLs, access tokens, JWT signing secrets, TMDB tokens, or provider secrets. The example is not loaded by `index.html`, and Step 2 does not integrate a Supabase client. A future local override may use ignored `config/supabase.local.js`; deployed values must come from the approved deployment configuration rather than a committed environment-specific file.

## Secret and environment-file rules

### Browser-public, environment-specific values

- Supabase project URL.
- Supabase publishable key or browser-safe anon key.

They may appear in a built public site because they confer no privilege by themselves, but they must not be confused with proof of authorization. Keep actual environment values out of the repository until the deployment design is reviewed.

### Privileged secrets

- Supabase secret/service-role keys.
- Database passwords and connection strings containing credentials.
- Supabase personal access tokens and management API tokens.
- JWT signing secrets and private signing-key files.
- OAuth client secrets, SMTP credentials, captcha secrets, and webhook secrets.
- TMDB tokens or other third-party server credentials.

Privileged secrets must never enter Git, browser JavaScript, GitHub Pages artifacts, issue text, screenshots, test fixtures, command transcripts, or routine application logs. Use the approved environment's secret manager or local ignored files. Server-side TMDB handling remains governed by [ADR-006](../architecture/decisions/ADR-006-server-side-tmdb-access.md).

The root `.gitignore` excludes `.env`, `.env.*`, `config/supabase.local.js`, `node_modules/`, `.supabase/`, `supabase/.temp/`, and `supabase/.branches/`, while preserving committed `.env.example` placeholders. `supabase/.gitignore` additionally excludes CLI branch/temp state and dotenvx local keys. Before every configuration commit, inspect `git status --untracked-files=all`, the complete staged diff, and `git diff --cached --check`.

## Environment boundaries

| Environment | Purpose | Data rule | Credential rule | Change path |
|---|---|---|---|---|
| Local | Developer reproduction and automated database/security tests | Synthetic/test identities and fixtures only; never production data | CLI-emitted local credentials only | Explicit `--local` commands against Docker |
| Development | Shared hosted integration after approval | Synthetic or approved non-production data | Separate development project keys and secrets | Reviewed link plus reviewed migrations/deployments |
| Staging | Release rehearsal with production-like configuration | Sanitized or purpose-built test data; no casual production copies | Separate staging project and secret set | Promotion of reviewed version-controlled artifacts |
| Production | Live private user trackers | Production data only under the accepted ownership/privacy contract | Production-only secrets with least privilege | Explicit release approval and recorded deployment evidence |

Never reuse a database, project reference, service-role key, access token, or third-party secret between environment classes. A linked development project is not permission to operate on staging or production.

## Local versus linked commands

### Allowed local foundation commands

- `npx --no-install supabase start`
- `npx --no-install supabase status`
- `npx --no-install supabase stop`
- `npx --no-install supabase db reset --local`

Phase-specific commands such as migration creation remain prohibited until their owning phase begins, even when they are local.

### Remote discovery

`npx --no-install supabase projects list --output json` is read-only but requires a Supabase personal access token. It may be used only when the maintainer knowingly authorizes account-level metadata discovery and output is handled as operational metadata. On 2026-08-18, the command was attempted without credentials and made no remote change; it returned `Access token not provided`.

### Commands requiring explicit remote approval

Do not run `supabase login`, `supabase link`, `supabase db pull`, `supabase db push`, linked migration commands, hosted database resets, project/branch creation or deletion, secret changes, function deployment, or any management operation without a named target environment and explicit approval for that operation. Never infer the target from a previous shell session.

Before an approved link:

1. Record the hosted display name, project reference, region, and environment class.
2. Confirm the operator is authorized for that project.
3. Confirm `git status`, reviewed migrations, backups/rollback posture, and the intended command.
4. Link using the explicitly supplied project reference.
5. Verify `supabase/.temp/project-ref` matches the approved reference; it remains ignored and must not be committed.
6. Use explicit local/linked flags where supported and pause again before any remote mutation.

Linking is connection state, not deployment approval. A link never authorizes `db push`, secrets, Functions, data import, or production changes.

## Forward-only migration corrections

Once a migration has been applied to any shared hosted environment, treat its filename and contents as immutable. Correct mistakes with a new, ordered, forward-only migration that records compatibility, data-safety, and operational recovery considerations. Do not rewrite, reorder, squash, rename, or delete applied migrations, and do not repair production solely through Studio or ad hoc SQL.

Before a migration reaches a shared environment, a review may replace an unshared draft, but the final history must reproduce a clean database from source control. Destructive or irreversible changes require explicit backup, verification, and recovery plans. Operational restore can recover an environment after disaster; it does not replace a forward correction in version control. The database contract remains authoritative and must change with any approved contract change.

## Approved hosted development environment

On 2026-08-18, the project owner approved the existing hosted project below as the **development** environment. These identifiers are operational metadata, not credentials.

| Property | Approved value |
|---|---|
| Environment class | Development |
| Project display name | `TVSeries Tracker` |
| Project reference | `rdebzeuibpxpjngzqgaj` |
| Project URL | `https://rdebzeuibpxpjngzqgaj.supabase.co` |
| Region | West Europe (London) |
| Region identifier | `eu-west-2` |
| Reported project status | Healthy |
| Reported hosted migrations | None |

The status and migration count are project-owner-supplied disposition evidence; Step 2B did not connect to or query the hosted database. This project is not staging and is not production. Separate staging and production projects, regions, configuration, keys, secrets, approvals, and promotion procedures are deferred until those environments are required.

Remote CLI linking remains deferred. Do not run `supabase link`, connect the GitHub repository through the Supabase dashboard, or perform a hosted database operation as part of Phase 2.2 closure. The browser publishable key has not been retrieved or recorded; [`../../config/supabase.example.js`](../../config/supabase.example.js) intentionally remains placeholder-only. Linking, dashboard integration, publishable-key retrieval, and every hosted mutation require their own later scope and approval.

Do not supply a service-role key, database password, personal access token, JWT secret, or other credential in chat or commit it to the repository.

## Related documents

- [Documentation index](../README.md)
- [Phase 2.2 validation](../roadmap/v2.0-phase-2.2-validation.md)
- [Supabase database contract](../architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [v2.0 roadmap](../roadmap/v2.0-plan.md)
- [ADR-001](../architecture/decisions/ADR-001-supabase-source-of-truth.md)
- [ADR-003](../architecture/decisions/ADR-003-auth-rls-and-rpc-mutation-boundary.md)
- [ADR-006](../architecture/decisions/ADR-006-server-side-tmdb-access.md)
