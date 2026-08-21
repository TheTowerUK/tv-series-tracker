"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../../js/migration-execution.js");
const sourceHash = "a".repeat(64), cloudHash = "b".repeat(64), resultHash = "c".repeat(64);
function prepared() { return { status: "review_required", accountId: "owner", source: { ok: true, sourcePayload: { schemaVersion: 1, shows: [] } }, sourceChecksum: sourceHash, cloudChecksum: cloudHash }; }
function envelope(outcome, data = null, conflict = null, error = null) { return { conflict, contractVersion: "2.0.0", data, entity: "migration", entityId: null, error, operation: "tracker_migrate_v1", outcome }; }
function repo({ receipt = null, shows = [] } = {}) { return { async readTracker() { return { ok: true, data: { shows, totals: { shows: shows.length, seasons: 0 } } }; }, async readMigrationReceipt() { return { ok: true, data: { receipt } }; } }; }

test("replace executes only tracker_migrate_v1 then verifies tracker, totals and receipt", async () => {
  const calls = [];
  const receipt = { migrationKey: api.MIGRATION_KEY, sourceChecksum: sourceHash, resultChecksum: sourceHash };
  const client = { async rpc(name, args) { calls.push([name, args]); return { data: envelope("success", { mode: "replace_cloud", sourceChecksum: sourceHash, resultChecksum: sourceHash, finalTotals: { shows: 0, seasons: 0 }, receipt }), error: null }; } };
  const service = api.createMigrationExecutionService({ client, cloudRepository: repo({ receipt }), cloudPayload: shows => ({ shows }), checksum: async () => sourceHash });
  const result = await service.execute({ accountId: "owner", prepared: prepared(), mode: "replace_cloud" });
  assert.equal(result.status, api.STATES.CLOUD_READ_ONLY);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "tracker_migrate_v1"); assert.deepEqual(Object.keys(calls[0][1]), ["request"]);
});

test("keep cloud verifies no receipt and writes dismissal only after success", async () => {
  let writes = 0;
  const client = { async rpc() { return { data: envelope("success", { mode: "keep_cloud", sourceChecksum: sourceHash, resultChecksum: cloudHash, finalTotals: { shows: 0, seasons: 0 }, receipt: null }), error: null }; } };
  const service = api.createMigrationExecutionService({ client, cloudRepository: repo(), cloudPayload: shows => ({ shows }), checksum: async () => cloudHash, markerStore: { async write() { writes += 1; } } });
  assert.equal((await service.execute({ accountId: "owner", prepared: prepared(), mode: "keep_cloud" })).status, api.STATES.CLOUD_READ_ONLY);
  assert.equal(writes, 1);
});

test("reviewed merge permits result checksum to differ while requiring matching receipt", async () => {
  const receipt = { migrationKey: api.MIGRATION_KEY, sourceChecksum: sourceHash, resultChecksum: resultHash };
  const client = { async rpc() { return { data: envelope("success", { mode: "reviewed_merge", sourceChecksum: sourceHash, resultChecksum: resultHash, finalTotals: { shows: 0, seasons: 0 }, receipt }), error: null }; } };
  const service = api.createMigrationExecutionService({ client, cloudRepository: repo({ receipt }), cloudPayload: shows => ({ shows }), checksum: async () => resultHash });
  assert.equal((await service.execute({ accountId: "owner", prepared: prepared(), mode: "reviewed_merge", mergeDecisions: { decisions: [] } })).status, api.STATES.CLOUD_READ_ONLY);
});

test("conflict refreshes review and failed independent verification never cuts over", async () => {
  let refreshed = 0;
  const conflictClient = { async rpc() { return { data: envelope("conflict", null, { kind: "cloud_checksum", private: "discarded" }), error: null }; } };
  const conflictService = api.createMigrationExecutionService({ client: conflictClient, cloudRepository: repo(), cloudPayload: x => x, checksum: async () => cloudHash, onConflict: async () => { refreshed += 1; } });
  assert.equal((await conflictService.execute({ accountId: "owner", prepared: prepared(), mode: "replace_cloud" })).status, api.STATES.CONFLICT);
  assert.equal(refreshed, 1); assert.doesNotMatch(JSON.stringify(conflictService.getState()), /private/);
  const badClient = { async rpc() { return { data: envelope("success", { mode: "replace_cloud", sourceChecksum: sourceHash, resultChecksum: sourceHash, finalTotals: { shows: 1, seasons: 0 }, receipt: null }), error: null }; } };
  const badService = api.createMigrationExecutionService({ client: badClient, cloudRepository: repo(), cloudPayload: x => x, checksum: async () => sourceHash });
  assert.equal((await badService.execute({ accountId: "owner", prepared: prepared(), mode: "replace_cloud" })).status, api.STATES.FAILURE);
});

test("transport and database auth failures normalize without diagnostics", () => {
  assert.equal(api.normalizeRpcResult({ error: { status: 401, message: "JWT private detail" } }).outcome, "unauthenticated");
  const result = api.normalizeRpcResult({ data: envelope("internal_error", null, null, { code: "auth_context_missing", detail: "SQL" }), error: null });
  assert.deepEqual(result.error, { code: "unauthenticated" }); assert.doesNotMatch(JSON.stringify(result), /SQL|JWT/);
});
