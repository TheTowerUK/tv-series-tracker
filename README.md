# TV Series Tracker v2.0

TV Series Tracker is a private, browser-based library for tracking television shows, artwork, and season-by-season viewing progress. It runs as a static GitHub Pages application and can be used either on one device or with an optional private cloud account.

## Using the tracker

### Device tracker

You can use the tracker without signing in. Changes are stored by this browser on this device. The packaged catalogue is used when no device tracker has been saved yet.

Use **Download local backup** to save a JSON copy of the device tracker. **Import JSON** restores a compatible device backup and **Reset baseline** replaces device changes with the packaged catalogue.

### Private cloud tracker

Cloud access is currently invite-only. Approved users can sign in with an emailed link or one-time code and use the same private tracker across devices. Public account registration is not available.

The first signed-in review keeps device data unchanged until the user explicitly chooses to keep the existing cloud tracker, replace it from the device, or review individual changes. After verified cutover, cloud data becomes authoritative; the device tracker remains preserved and returns after sign-out.

Use **Export cloud tracker** to download the signed-in cloud tracker. Keep exports somewhere safe: initial v2.0 cloud exports are archives intended for support-assisted restoration, and a self-service cloud restore screen is deferred beyond the initial release. For access or recovery support, use the repository's [GitHub issue tracker](https://github.com/TheTowerUK/tv-series-tracker/issues) without posting private tracker data, credentials, or authentication links.

## Artwork search

Approved signed-in users can search for television artwork through the configured hosted artwork-search service. Use **Find missing artwork** to discover artwork for existing or imported shows, review confident and ambiguous matches, and explicitly apply only the selections you approve. Discovery does not change the tracker, and application never automatically overwrites existing or manually entered artwork.

The ordinary artwork picker remains available when editing one show. Signed-out users can continue to enter a poster URL manually, and missing or unavailable artwork falls back to a title placeholder.

## Privacy and security

- Device tracker data stays in the current browser until the user explicitly chooses how to move it to an approved private cloud account. The preserved device copy remains available after migration and returns after sign-out.
- Private cloud tracker data is available only to its approved signed-in account; public self-signup is not offered.
- Artwork searches are sent only when the user requests them. The service stores no query history or analytics.
- Do not include email links, codes, tokens, credentials, or private tracker contents in public support requests.

## Deployment and development

The application is deployed from `main` through the reviewed GitHub Pages Actions workflow. The workflow runs the Node test suite, builds an allow-listed static artifact, and generates browser-public Supabase configuration inside that artifact only.

For a local checkout:

1. Install Node.js 20 or newer and Docker Desktop when Supabase integration work is required.
2. Run `npm ci` to install the repository-pinned Supabase CLI.
3. Serve the repository through a local HTTP server; Auth and Edge Function work should use the documented local Supabase environment.
4. Keep `config/supabase.local.js` and `supabase/functions/.env.local` local and ignored.

Common checks:

```powershell
npm test
npm run test:tmdb
npx --no-install supabase --version
```

Detailed maintainer documentation:

- [Documentation index](docs/README.md)
- [v2.0 release notes](CHANGELOG.md)
- [Supabase database contract](docs/architecture/SUPABASE_DATABASE_CONTRACT_V2.md)
- [Environment and configuration contract](docs/development/supabase-environments.md)
- [TMDB Edge Function contract](docs/development/tmdb-edge-function.md)
- [v2.0 roadmap](docs/roadmap/v2.0-plan.md)
- [Phase 2.7 hosted validation](docs/roadmap/v2.0-phase-2.7-validation.md)

TTSPlayer is a separate project and is completely out of scope for this repository.
