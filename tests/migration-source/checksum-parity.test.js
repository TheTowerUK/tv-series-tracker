"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
const { normalizeV1Payload } = require("../../js/migration-source.js");
const { canonicalTrackerText, sha256Hex, trackerChecksum } = require("../../js/tracker-checksum.js");

const EMPTY_HASH = "c1885444fe79edb7a4d1074af7b69e4a7d5264274b53bea29f00e6438b5c120c";
const BASELINE_HASH = "3bcfde529f776d4bb3a1a252c2673e80d0c305b3e7869e1c54d63813ca617d33";

const richFixture = {
  shows: [
    {
      identity: "legacy:zeta", legacyId: "zeta", platform: "TV",
      title: "Quote \" slash \\ café ☃", firstAirDate: null, synopsis: "Line\nTwo",
      posterUrl: null, tmdbId: null, tmdbPosterPath: null,
      createdAt: "2026-08-19T13:14:15.006+01:00", updatedAt: "2026-08-19T12:14:15.999Z",
      seasons: [{ status: "completed", number: 10 }, { status: "watching", number: 2 }]
    },
    {
      identity: "legacy:alpha", legacyId: "alpha", platform: "Netflix", title: "Alpha",
      firstAirDate: "2020-01-02", synopsis: "", posterUrl: "https://example.invalid/p.jpg",
      tmdbId: 42, tmdbPosterPath: "/p.jpg", createdAt: "2020-01-02T03:04:05Z",
      updatedAt: "2020-01-02T03:04:05.1234Z", seasons: []
    }
  ],
  schemaVersion: 2
};

const richCanonical = "{\"schemaVersion\":2,\"shows\":[{\"identity\":\"legacy:alpha\",\"legacyId\":\"alpha\",\"platform\":\"Netflix\",\"title\":\"Alpha\",\"firstAirDate\":\"2020-01-02\",\"synopsis\":\"\",\"posterUrl\":\"https://example.invalid/p.jpg\",\"tmdbId\":42,\"tmdbPosterPath\":\"/p.jpg\",\"createdAt\":\"2020-01-02T03:04:05.000Z\",\"updatedAt\":\"2020-01-02T03:04:05.123Z\",\"seasons\":[]},{\"identity\":\"legacy:zeta\",\"legacyId\":\"zeta\",\"platform\":\"TV\",\"title\":\"Quote \\\" slash \\\\ café ☃\",\"firstAirDate\":null,\"synopsis\":\"Line\\nTwo\",\"posterUrl\":null,\"tmdbId\":null,\"tmdbPosterPath\":null,\"createdAt\":\"2026-08-19T12:14:15.006Z\",\"updatedAt\":\"2026-08-19T12:14:15.999Z\",\"seasons\":[{\"number\":2,\"status\":\"watching\"},{\"number\":10,\"status\":\"completed\"}]}]}";

test("empty tracker canonical text and SHA-256 match the database fixture", async () => {
  const payload = { schemaVersion: 2, shows: [] };
  assert.equal(canonicalTrackerText(payload), JSON.stringify(payload));
  assert.equal(await trackerChecksum(payload, webcrypto), EMPTY_HASH);
});

test("rich fixture matches the authoritative database canonical text exactly", async () => {
  const text = canonicalTrackerText(richFixture);
  assert.equal(text, richCanonical);
  assert.equal(text.includes("café ☃"), true);
  assert.equal(text.includes("\n"), false);
  assert.match(await sha256Hex(text, webcrypto), /^[0-9a-f]{64}$/);
});

test("packaged 352-show baseline matches the Phase 2.4 checksum", async () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../data/shows.json"), "utf8"));
  const normalized = normalizeV1Payload({ schemaVersion: 1, shows: catalog.shows });
  assert.equal(normalized.shows.length, 352);
  assert.equal(normalized.shows.reduce((total, show) => total + show.seasons.length, 0), 1028);
  assert.equal(await trackerChecksum(normalized, webcrypto), BASELINE_HASH);
});

test("canonicalization and hashing are deterministic without mutating input order", async () => {
  const before = JSON.stringify(richFixture);
  const firstText = canonicalTrackerText(richFixture);
  const secondText = canonicalTrackerText(richFixture);
  const firstHash = await sha256Hex(firstText, webcrypto);
  const secondHash = await sha256Hex(secondText, webcrypto);
  assert.equal(firstText, secondText);
  assert.equal(firstHash, secondHash);
  assert.equal(JSON.stringify(richFixture), before);
});
