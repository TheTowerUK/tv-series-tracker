"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const checksum = require("../../js/tracker-checksum.js");
const cloudExport = require("../../js/cloud-tracker-export.js");

function snapshot() {
  return [{ id: "82100000-0000-4000-8000-000000000002", legacyId: null, platform: "Netflix", title: "Zulu",
    firstAirDate: "2024-02-03", description: "Cloud synopsis", posterUrl: "https://example.test/poster.jpg",
    tmdb: { id: 42, posterPath: "/tmdb.jpg" }, createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T11:02:03.4567Z", revision: "12",
    seasons: [{ id: "s2", showId: "x", number: 2, status: "Watching", createdAt: "x", updatedAt: "x", revision: "7" },
      { id: "s1", showId: "x", number: 1, status: "Not Started", createdAt: "x", updatedAt: "x", revision: "2" }] },
  { id: "82100000-0000-4000-8000-000000000001", legacyId: "tv-0001", platform: "BBC iPlayer", title: "Alpha",
    firstAirDate: null, description: "", posterUrl: null, tmdb: { id: null, posterPath: null }, createdAt: "2026-08-19T09:00:00.000Z",
    updatedAt: "2026-08-19T09:00:00.000Z", revision: "1", seasons: [
      { number: 5, status: "Region Blocked", revision: "1" }, { number: 4, status: "Purchase Only", revision: "1" },
      { number: 3, status: "Completed", revision: "1" }
    ] }];
}

test("builds the exact restore-compatible v2 shape with deterministic identity ordering", () => {
  const payload = cloudExport.buildCloudExportPayload(snapshot(), { exportedAt: "2026-08-21T12:34:56Z" });
  assert.deepEqual(Object.keys(payload), ["schemaVersion", "contractVersion", "exportedAt", "shows"]);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.contractVersion, "2.0.0");
  assert.equal(payload.exportedAt, "2026-08-21T12:34:56.000Z");
  assert.deepEqual(payload.shows.map((show) => show.identity), ["cloud:82100000-0000-4000-8000-000000000002", "legacy:tv-0001"]);
  assert.equal(payload.shows[1].legacyId, "tv-0001");
  assert.deepEqual(payload.shows[0].seasons.map((season) => season.number), [1, 2]);
});

test("maps all statuses and preserves independent poster fields and normalized timestamps", () => {
  const payload = cloudExport.buildCloudExportPayload(snapshot());
  assert.deepEqual(payload.shows.flatMap((show) => show.seasons.map((season) => season.status)).sort(),
    ["completed", "not_started", "purchase_only", "region_blocked", "watching"]);
  assert.equal(payload.shows[0].posterUrl, "https://example.test/poster.jpg");
  assert.equal(payload.shows[0].tmdbPosterPath, "/tmdb.jpg");
  assert.equal(payload.shows[0].createdAt, "2026-08-20T10:00:00.000Z");
  assert.equal(payload.shows[0].updatedAt, "2026-08-20T11:02:03.456Z");
});

test("validates decimal revisions while excluding server concurrency metadata from restore payload", () => {
  const payload = cloudExport.buildCloudExportPayload(snapshot());
  assert.doesNotMatch(JSON.stringify(payload), /revision|"id":"s[12]"/);
  const invalid = snapshot(); invalid[0].revision = 12;
  assert.throws(() => cloudExport.buildCloudExportPayload(invalid), /revision/);
  const invalidSeason = snapshot(); invalidSeason[0].seasons[0].revision = 7;
  assert.throws(() => cloudExport.buildCloudExportPayload(invalidSeason), /revision/);
});

test("checksum is computed from canonical logical content rather than pretty JSON bytes", async () => {
  const prepared = await cloudExport.prepareCloudExport(snapshot(), { exportedAt: "2026-08-21T12:00:00.000Z", cryptoProvider: webcrypto });
  const expected = await checksum.trackerChecksum({ schemaVersion: 2, shows: prepared.payload.shows }, webcrypto);
  assert.equal(prepared.checksum, expected);
  assert.notEqual(prepared.checksum, await checksum.sha256Hex(JSON.stringify(prepared.payload, null, 2), webcrypto));
});

test("repeated exports differ only in exportedAt when the verified snapshot is unchanged", () => {
  const first = cloudExport.buildCloudExportPayload(snapshot(), { exportedAt: "2026-08-21T12:00:00Z" });
  const second = cloudExport.buildCloudExportPayload(snapshot().reverse(), { exportedAt: "2026-08-21T13:00:00Z" });
  assert.deepEqual(first.shows, second.shows);
  assert.notEqual(first.exportedAt, second.exportedAt);
});

test("payload and module disclose no account, auth, configuration, receipt, or restore data", () => {
  const text = JSON.stringify(cloudExport.buildCloudExportPayload(snapshot()));
  assert.doesNotMatch(text, /email|userId|accessToken|refreshToken|jwt|supabase|receipt|service.role/i);
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/cloud-tracker-export.js"), "utf8");
  assert.doesNotMatch(source, /\.rpc\s*\(|tracker_restore_v2|localStorage|sessionStorage/);
});

test("application keeps local backup separate and permits cloud export only for trusted states", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../js/app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  assert.match(html, /Download local backup/);
  assert.match(html, /Export cloud tracker/);
  assert.match(app, /\["cloud_ready","cloud_conflict"\]\.includes\(authority\)/);
  assert.match(app, /cloudExportBtn\.disabled=!\["cloud_ready","cloud_conflict"\]\.includes\(authority\)/);
  assert.match(app, /localRepository\.readTracker\(\{baseline:baselineShows\}\)/);
  assert.doesNotMatch(app.slice(app.indexOf("async function exportCloudTracker"), app.indexOf("async function importJson")), /localRepository|cloudController\.mutate|\.rpc\s*\(/);
});
