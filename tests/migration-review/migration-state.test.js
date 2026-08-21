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

test("state and UI source contain no migration RPC or write path", () => {
  const files = ["../../js/migration-state.js", "../../js/migration-review-ui.js"].map((file) => fs.readFileSync(path.resolve(__dirname, file), "utf8")).join("\n");
  assert.doesNotMatch(files, /tracker_migrate_v1|\.rpc\s*\(|\.from\s*\([^)]*\)\s*\.\s*(?:insert|update|upsert|delete)\s*\(/s);
});
