"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("root README describes the v2.0 device and private-cloud product", () => {
  const readme = read("README.md");
  assert.match(readme, /^# TV Series Tracker v2\.0/m);
  assert.match(readme, /Cloud access is currently invite-only\./);
  assert.match(readme, /Device tracker/);
  assert.match(readme, /support-assisted restoration/);
  assert.doesNotMatch(readme, /runs without a backend|window\.TMDB_CONFIG|config\/tmdb\.local\.js|v1\.2 additions|v1\.3 local TMDB/i);
});

test("normal UI explains invite-only access and the two export meanings", () => {
  const html = read("index.html");
  assert.match(html, /Cloud access is invite-only\./);
  assert.match(html, /Device backup<\/strong> saves this browser's tracker\./);
  assert.match(html, /Cloud export<\/strong> saves the signed-in cloud tracker for support-assisted restoration\./);
  assert.doesNotMatch(html, /TMDB ARTWORK TEST/);
  assert.match(html, />ARTWORK SEARCH</);
});

test("account wording follows the existing tracker authority", () => {
  const authUi = read("js/auth-ui.js");
  const app = read("js/app.js");
  assert.match(authUi, /Your device tracker remains active while your private cloud tracker is checked\./);
  assert.match(authUi, /Your private cloud tracker is active\. This device tracker is preserved and returns after sign-out\./);
  assert.doesNotMatch(authUi, /This step continues using the local tracker/);
  assert.match(app, /TV_TRACKER_AUTH_UI\?\.setTrackerAuthority\(authority\)/);
  assert.doesNotMatch(authUi, /\.from\s*\(|\.rpc\s*\(|tracker_migrate_v1|tracker_restore_v2/);
});

test("artwork selection hides numeric TMDB IDs while retaining internal metadata", () => {
  const app = read("js/app.js");
  assert.doesNotMatch(app, /Selected TMDB #/);
  assert.match(app, /Selected artwork from TMDB\./);
  assert.match(app, /id: result\.id/);
});

test("release guidance covers reviewed artwork and support-assisted cloud recovery", () => {
  const readme = read("README.md");
  const changelog = read("CHANGELOG.md");
  assert.match(readme, /Find missing artwork/);
  assert.match(readme, /never automatically overwrites existing or manually entered artwork/);
  assert.match(readme, /Keep exports somewhere safe/);
  assert.match(readme, /support-assisted restoration/);
  assert.match(changelog, /## 2\.0\.0 — 2026-08-30/);
  assert.doesNotMatch(changelog, /prerelease|release candidate in preparation/);
});

test("interactive release surfaces expose focus, dialog and progress semantics", () => {
  const html = read("index.html");
  const styles = read("css/styles.css");
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /tmdb-candidate\.selected \.tmdb-select::before\{content:"✓ /);
  assert.match(html, /id="artworkEnrichmentDialog"[^>]*aria-labelledby="artworkEnrichmentTitle"/);
  assert.match(html, /id="artworkDiscoveryProgressBar"[^>]*aria-label="Artwork discovery progress"/);
  assert.match(html, /id="artworkSelectedSummary"[^>]*role="status"[^>]*aria-live="polite"/);
});
