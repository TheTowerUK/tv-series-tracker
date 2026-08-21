"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMigrationDiff, cloudTrackerPayload, decisionsFromSelections } = require("../../js/migration-review.js");
const { trackerChecksum } = require("../../js/tracker-checksum.js");

function localShow(overrides = {}) {
  return { identity: "legacy:tv-1", legacyId: "tv-1", platform: "TV", title: "Local title", firstAirDate: null,
    synopsis: "Local", posterUrl: null, tmdbId: null, tmdbPosterPath: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    seasons: [{ number: 1, status: "watching" }], ...overrides };
}
function cloudShow(overrides = {}) {
  return { id: "00000000-0000-4000-8000-000000000001", legacyId: "tv-1", platform: "TV", title: "Cloud title", firstAirDate: null,
    description: "Cloud", posterUrl: null, tmdb: null, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z", revision: "7",
    seasons: [{ id: "s1", showId: "00000000-0000-4000-8000-000000000001", number: 1, status: "Completed", revision: "9" }], ...overrides };
}

test("cloud payload preserves canonical identity, status and checksum inputs", async () => {
  const payload = cloudTrackerPayload([cloudShow()]);
  assert.equal(payload.shows[0].identity, "legacy:tv-1");
  assert.equal(payload.shows[0].seasons[0].status, "completed");
  assert.match(await trackerChecksum(payload), /^[0-9a-f]{64}$/);
  const native = cloudTrackerPayload([cloudShow({ id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", legacyId: null })]);
  assert.equal(native.shows[0].identity, "cloud:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("diff ordering and identities are deterministic", () => {
  const source = { schemaVersion: 2, shows: [localShow({ legacyId: "z", identity: "legacy:z" }), localShow({ legacyId: "a", identity: "legacy:a" })] };
  const items = buildMigrationDiff(source, []);
  assert.deepEqual(items.filter((entry) => entry.entityType === "show").map((entry) => entry.sourceIdentity), ["legacy:a", "legacy:z"]);
  assert.equal(items.find((entry) => entry.entityType === "season").sourceIdentity.includes("/season:1"), true);
});

test("all show decisions have exact identities and revision placement", () => {
  const changed = buildMigrationDiff({ schemaVersion: 2, shows: [localShow()] }, [cloudShow()]);
  const showItem = changed.find((entry) => entry.entityType === "show");
  for (const action of ["keep_cloud_record", "apply_local_record"]) {
    const decision = decisionsFromSelections(changed, { [showItem.id]: action }).decisions[0];
    assert.equal(decision.action, action);
    assert.equal(decision.expectedRevision, action === "apply_local_record" ? "7" : null);
  }
  const localOnly = buildMigrationDiff({ schemaVersion: 2, shows: [localShow()] }, []);
  const create = localOnly.find((entry) => entry.entityType === "show");
  assert.equal(decisionsFromSelections(localOnly, { [create.id]: "create_local_record" }).decisions[0].expectedRevision, null);
  const cloudOnly = buildMigrationDiff({ schemaVersion: 2, shows: [] }, [cloudShow()]);
  const remove = cloudOnly.find((entry) => entry.entityType === "show");
  assert.equal(decisionsFromSelections(cloudOnly, { [remove.id]: "delete_cloud_record" }).decisions[0].expectedRevision, "7");
});

test("all season decisions have exact identities and revision placement", () => {
  const changed = buildMigrationDiff({ schemaVersion: 2, shows: [localShow()] }, [cloudShow()]);
  const season = changed.find((entry) => entry.entityType === "season");
  for (const action of ["keep_cloud_season", "apply_local_season"]) {
    const decision = decisionsFromSelections(changed, { [season.id]: action }).decisions[0];
    assert.equal(decision.action, action);
    assert.equal(decision.expectedRevision, action === "apply_local_season" ? "9" : null);
  }
  const localOnly = buildMigrationDiff({ schemaVersion: 2, shows: [localShow()] }, []);
  const parent = localOnly.find((entry) => entry.entityType === "show");
  const child = localOnly.find((entry) => entry.entityType === "season");
  const created = decisionsFromSelections(localOnly, { [parent.id]: "create_local_record", [child.id]: "create_local_season" });
  assert.equal(created.decisions[1].expectedRevision, null);
  const cloudOnly = buildMigrationDiff({ schemaVersion: 2, shows: [] }, [cloudShow()]);
  const cloudSeason = cloudOnly.find((entry) => entry.entityType === "season");
  assert.equal(decisionsFromSelections(cloudOnly, { [cloudSeason.id]: "delete_cloud_season" }).decisions[0].expectedRevision, "9");
});

test("no selection means no implicit local application or cloud deletion", () => {
  const items = buildMigrationDiff({ schemaVersion: 2, shows: [localShow({ legacyId: "local", identity: "legacy:local" })] }, [cloudShow({ legacyId: "cloud" })]);
  assert.deepEqual(decisionsFromSelections(items, {}), { decisions: [] });
});

test("parent deletion rejects every child decision and child create requires parent create", () => {
  const cloudOnly = buildMigrationDiff({ schemaVersion: 2, shows: [] }, [cloudShow()]);
  const parent = cloudOnly.find((entry) => entry.entityType === "show");
  const child = cloudOnly.find((entry) => entry.entityType === "season");
  assert.throws(() => decisionsFromSelections(cloudOnly, { [parent.id]: "delete_cloud_record", [child.id]: "keep_cloud_season" }), /Parent deletion/);
  const localOnly = buildMigrationDiff({ schemaVersion: 2, shows: [localShow()] }, []);
  const localChild = localOnly.find((entry) => entry.entityType === "season");
  assert.throws(() => decisionsFromSelections(localOnly, { [localChild.id]: "create_local_season" }), /parent show/);
});
