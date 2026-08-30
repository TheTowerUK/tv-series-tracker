# TV Series Tracker release notes

## 2.0.0 — 2026-08-30

TV Series Tracker v2.0 introduces:

- an optional, invite-only private cloud tracker alongside the device tracker;
- guided Keep Cloud, Replace Cloud, and Reviewed Merge choices while preserving the device tracker after migration;
- writable cloud show and season tracking with safe conflict review across devices;
- separate device backup and cloud export, with cloud-export recovery currently support-assisted;
- authenticated hosted artwork search with no browser artwork-service credential; and
- **Find missing artwork**, including write-free discovery, review of confident or ambiguous matches, and explicit application that does not overwrite existing artwork.

The v2.0 work also establishes reproducible database, security, migration, hosted deployment, and validation foundations. Those implementation details remain in the [developer documentation](docs/README.md). Cloud access remains invite-only, and cloud-export restoration remains support-assisted in this release.
