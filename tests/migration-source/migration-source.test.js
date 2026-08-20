"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STATES, STATUS_MAP, inspectMigrationSource, normalizeV1Payload } = require("../../js/migration-source.js");

function storage(value, present = true) {
  return { getItem() { return present ? value : null; } };
}

function show(overrides = {}) {
  return {
    id: "tv-1", platform: "TV", title: "Example", firstAirDate: null, description: "",
    posterUrl: "", seasons: [{ number: 1, status: "Not Started" }],
    createdAt: "2026-08-19T13:14:15.006+01:00", updatedAt: "2026-08-19T12:14:15.999Z",
    ...overrides
  };
}

test("distinguishes a missing migration source without silently selecting baseline", () => {
  const result = inspectMigrationSource({ storage: storage(null, false), baseline: [show()] });
  assert.equal(result.state, STATES.MISSING);
  assert.equal(result.ok, false);
  assert.equal(result.normalizedPayload, null);
});

test("can explicitly resolve an absent source to the packaged baseline", () => {
  const result = inspectMigrationSource({ storage: storage(null, false), baseline: { shows: [show()] }, usePackagedBaselineWhenMissing: true });
  assert.equal(result.state, STATES.MISSING);
  assert.equal(result.ok, true);
  assert.equal(result.resolution, "packaged_baseline");
  assert.equal(result.normalizedPayload.shows[0].legacyId, "tv-1");
});

test("distinguishes valid v1 envelope and supported bare array", () => {
  const envelope = inspectMigrationSource({ storage: storage(JSON.stringify({ schemaVersion: 1, shows: [show()] })) });
  const bare = inspectMigrationSource({ storage: storage(JSON.stringify([show()])) });
  assert.equal(envelope.state, STATES.VALID_ENVELOPE);
  assert.equal(bare.state, STATES.VALID_BARE_ARRAY);
  assert.deepEqual(envelope.normalizedPayload, bare.normalizedPayload);
});

test("distinguishes malformed, structurally invalid and unsupported sources", () => {
  assert.equal(inspectMigrationSource({ storage: storage("{") }).state, STATES.MALFORMED_JSON);
  assert.equal(inspectMigrationSource({ storage: storage(JSON.stringify({ schemaVersion: 1, shows: [{}] })) }).state, STATES.STRUCTURALLY_INVALID);
  assert.equal(inspectMigrationSource({ storage: storage(JSON.stringify({ schemaVersion: 3, shows: [] })) }).state, STATES.UNSUPPORTED_SCHEMA);
});

test("existing LocalStorage takes precedence and invalid LocalStorage never falls back", () => {
  const local = show({ id: "local", title: "Local wins" });
  const valid = inspectMigrationSource({ storage: storage(JSON.stringify([local])), baseline: [show({ id: "baseline" })], usePackagedBaselineWhenMissing: true });
  assert.equal(valid.normalizedPayload.shows[0].legacyId, "local");
  const invalid = inspectMigrationSource({ storage: storage("bad"), baseline: [show()], usePackagedBaselineWhenMissing: true });
  assert.equal(invalid.state, STATES.MALFORMED_JSON);
  assert.equal(invalid.normalizedPayload, null);
});

test("maps all five statuses without coercion", () => {
  const seasons = Object.keys(STATUS_MAP).map((status, index) => ({ number: index + 1, status }));
  const normalized = normalizeV1Payload({ schemaVersion: 1, shows: [show({ seasons })] });
  assert.deepEqual(normalized.shows[0].seasons.map((season) => season.status), Object.values(STATUS_MAP));
});

test("rejects duplicate show identities and seasons at deterministic paths", () => {
  const duplicateShows = inspectMigrationSource({ storage: storage(JSON.stringify([show(), show()])) });
  assert.deepEqual(duplicateShows.errors, [{ path: "/shows/1/id", code: "duplicate" }]);
  const duplicateSeasons = inspectMigrationSource({ storage: storage(JSON.stringify([show({ seasons: [{ number: 1, status: "Watching" }, { number: 1, status: "Completed" }] })])) });
  assert.deepEqual(duplicateSeasons.errors, [{ path: "/shows/0/seasons/1/number", code: "duplicate" }]);
});

test("validates TMDB aliases and does not repair contradictions", () => {
  const matching = normalizeV1Payload({ schemaVersion: 1, shows: [show({ tmdb: { id: 42, name: "TMDB", firstAirDate: "2020-01-02", posterPath: "/p.jpg" }, tmdbId: 42, tmdbPosterPath: "/p.jpg" })] });
  assert.equal(matching.shows[0].tmdbId, 42);
  const contradiction = inspectMigrationSource({ storage: storage(JSON.stringify([show({ tmdb: { id: 42 }, tmdbId: 43 })])) });
  assert.deepEqual(contradiction.errors, [{ path: "/shows/0/tmdbId", code: "contradiction" }]);
});

test("rejects invalid dates, timestamps, fields and values without lossy coercion", () => {
  const cases = [
    [show({ firstAirDate: "2023-02-29" }), "/shows/0/firstAirDate"],
    [show({ createdAt: "not-a-time" }), "/shows/0/createdAt"],
    [show({ title: " padded " }), "/shows/0/title"],
    [show({ seasons: [{ number: "1", status: "Watching" }] }), "/shows/0/seasons/0/number"],
    [show({ surprise: true }), "/shows/0/surprise"]
  ];
  for (const [candidate, path] of cases) {
    const result = inspectMigrationSource({ storage: storage(JSON.stringify([candidate])) });
    assert.equal(result.state, STATES.STRUCTURALLY_INVALID);
    assert.equal(result.errors[0].path, path);
  }
});
