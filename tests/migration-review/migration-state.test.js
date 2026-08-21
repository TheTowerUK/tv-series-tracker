"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STATES, CHOICES, createMigrationStateService } = require("../../js/migration-state.js");

const source = Object.freeze({ ok: true, state: "valid_v1_envelope", normalizedPayload: { schemaVersion: 2, shows: [] } });
function repository({ receipt = null, receiptError = null, trackerError = null, cloudShows = [] } = {}) {
  return {
    async readMigrationReceipt() { return receiptError ? { ok: false, error: receiptError } : { ok: true, data: { receipt } }; },
    async readTracker() { return trackerError ? { ok: false, error: trackerError } : { ok: true, data: { shows: cloudShows, totals: { shows: cloudShows.length, seasons: 0 } } }; }
  };
}
function service(options = {}) {
  return createMigrationStateService({ sourceInspector: () => options.source || source, checksum: async (payload) => payload === source.normalizedPayload ? "source-hash" : "cloud-hash",
    cloudRepository: repository(options), cloudPayload: (shows) => ({ schemaVersion: 2, shows }), diffBuilder: () => Object.freeze([{ id: "review" }]),
    storage: {}, baseline: [] });
}

test("no receipt and valid source exposes exactly three review choices and checksums", async () => {
  const result = await service().applyAuthState({ status: "authenticated", accountId: "owner-a" });
  assert.equal(result.status, STATES.REVIEW_REQUIRED);
  assert.deepEqual(result.choices, CHOICES);
  assert.equal(result.sourceChecksum, "source-hash");
  assert.equal(result.cloudChecksum, "cloud-hash");
});

test("receipt suppresses review and historic checksum need not match current cloud", async () => {
  const receipt = { migrationKey: "localstorage-tvSeriesTrackerData.v1", resultChecksum: "historic-hash" };
  const invalidCurrentDevice = { ok: false, state: "malformed_json", normalizedPayload: null };
  const result = await service({ receipt, source: invalidCurrentDevice }).applyAuthState({ status: "authenticated", accountId: "owner-a" });
  assert.equal(result.status, STATES.COMPLETED);
  assert.equal(result.receipt, receipt);
  assert.equal(result.cloudChecksum, "cloud-hash");
  assert.notEqual(result.receipt.resultChecksum, result.cloudChecksum);
});

test("malformed source blocks destructive choices when no receipt exists", async () => {
  const invalid = { ok: false, state: "malformed_json", normalizedPayload: null };
  const result = await service({ source: invalid }).applyAuthState({ status: "authenticated", accountId: "owner-a" });
  assert.equal(result.status, STATES.SOURCE_ERROR);
  assert.deepEqual(result.choices, []);
});

test("safe receipt and tracker read failures become cloud errors", async () => {
  assert.equal((await service({ receiptError: { code: "network_unavailable" } }).applyAuthState({ status: "authenticated", accountId: "a" })).status, STATES.CLOUD_ERROR);
  assert.equal((await service({ trackerError: { code: "forbidden" } }).applyAuthState({ status: "authenticated", accountId: "a" })).error.code, "forbidden");
});

test("thrown cloud transport failures are normalized safely", async () => {
  const cloudRepository = { async readMigrationReceipt() { throw new Error("private transport detail"); }, async readTracker() { throw new Error("unused"); } };
  const instance = createMigrationStateService({ sourceInspector: () => source, checksum: async () => "hash", cloudRepository,
    cloudPayload: (shows) => ({ schemaVersion: 2, shows }), diffBuilder: () => [], storage: {}, baseline: [] });
  const result = await instance.applyAuthState({ status: "authenticated", accountId: "owner" });
  assert.deepEqual(result.error, { code: "cloud_read_failed" });
  assert.equal(JSON.stringify(result).includes("private transport detail"), false);
});

test("sign-out and account change invalidate prior review state", async () => {
  const instance = service();
  await instance.applyAuthState({ status: "authenticated", accountId: "owner-a" });
  assert.equal(instance.getState().accountId, "owner-a");
  instance.applyAuthState({ status: "signed_out", accountId: null });
  assert.equal(instance.getState().status, STATES.IDLE);
  await instance.applyAuthState({ status: "authenticated", accountId: "owner-b" });
  assert.equal(instance.getState().accountId, "owner-b");
});

test("migration UI delegates its sole cloud mutation to the execution service", () => {
  const stateFile = fs.readFileSync(path.resolve(__dirname, "../../js/migration-state.js"), "utf8");
  const uiFile = fs.readFileSync(path.resolve(__dirname, "../../js/migration-review-ui.js"), "utf8");
  assert.doesNotMatch(stateFile, /tracker_migrate_v1|\.rpc\s*\(/);
  assert.doesNotMatch(uiFile, /\.rpc\s*\(|\.from\s*\([^)]*\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/s);
});

test("matching keep-cloud marker suppresses repeat review and source change invalidates it", async () => {
  let accepted = true;
  const markerStore = { async read() { return accepted; } };
  const instance = createMigrationStateService({ sourceInspector: () => source,
    checksum: async payload => payload === source.normalizedPayload ? "source-hash" : "cloud-hash",
    cloudRepository: repository(), cloudPayload: shows => ({ schemaVersion: 2, shows }),
    diffBuilder: () => [], markerStore, storage: {}, baseline: [] });
  assert.equal((await instance.applyAuthState({ status: "authenticated", accountId: "owner" })).status, STATES.KEEP_DISMISSED);
  accepted = false;
  assert.equal((await instance.inspect("owner")).status, STATES.REVIEW_REQUIRED);
});

test("receipt takes precedence over a marker and completion always uses a fresh cloud read", async () => {
  let markerReads = 0, trackerReads = 0;
  const receipt = { migrationKey: "localstorage-tvSeriesTrackerData.v1", resultChecksum: "historic" };
  const cloudRepository = { async readMigrationReceipt() { return { ok: true, data: { receipt } }; },
    async readTracker() { trackerReads += 1; return { ok: true, data: { shows: [{ id: `fresh-${trackerReads}` }], totals: { shows: 1, seasons: 0 } } }; } };
  const instance = createMigrationStateService({ sourceInspector: () => source, checksum: async () => "cloud-hash",
    cloudRepository, cloudPayload: shows => ({ schemaVersion: 2, shows }), diffBuilder: () => [],
    markerStore: { async read() { markerReads += 1; return true; } }, storage: {}, baseline: [] });
  const first = await instance.applyAuthState({ status: "authenticated", accountId: "owner" });
  const second = await instance.applyAuthState({ status: "authenticated", accountId: "owner" });
  assert.equal(first.status, STATES.COMPLETED); assert.equal(second.status, STATES.COMPLETED);
  assert.equal(first.cloudShows[0].id, "fresh-1"); assert.equal(second.cloudShows[0].id, "fresh-2");
  assert.equal(markerReads, 0); assert.equal(trackerReads, 2);
});

test("account switch invalidates a slower prior inspection", async () => {
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  let receiptReads = 0;
  const cloudRepository = { async readMigrationReceipt() { receiptReads += 1; if (receiptReads === 1) await gate; return { ok: true, data: { receipt: null } }; },
    async readTracker() { return { ok: true, data: { shows: [], totals: { shows: 0, seasons: 0 } } }; } };
  const instance = createMigrationStateService({ sourceInspector: () => source, checksum: async () => "hash",
    cloudRepository, cloudPayload: shows => ({ schemaVersion: 2, shows }), diffBuilder: () => [], storage: {}, baseline: [] });
  const first = instance.applyAuthState({ status: "authenticated", accountId: "owner-a" });
  const second = instance.applyAuthState({ status: "authenticated", accountId: "owner-b" });
  releaseFirst(); await Promise.all([first, second]);
  assert.equal(instance.getState().accountId, "owner-b");
});
