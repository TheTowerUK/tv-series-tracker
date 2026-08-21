"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMigrationRequest } = require("../../js/migration-execution.js");
const hashA = "a".repeat(64), hashB = "b".repeat(64);
function prepared() { return { status: "review_required", source: { ok: true, sourcePayload: { schemaVersion: 1, shows: [] } }, sourceChecksum: hashA, cloudChecksum: hashB }; }

test("request exactly preserves the validated source and approved database keys", () => {
  const state = prepared();
  const result = buildMigrationRequest(state, "replace_cloud");
  assert.deepEqual(Object.keys(result).sort(), ["expectedCloudChecksum", "mergeDecisions", "migrationKey", "mode", "sourceChecksum", "sourcePayload", "sourceSchemaVersion"].sort());
  assert.equal(result.sourcePayload, state.source.sourcePayload);
  assert.deepEqual(result.mergeDecisions, { decisions: [] });
});

test("reviewed merge preserves exact explicit decisions and other modes reject them", () => {
  const decisions = { decisions: [{ entity: "show", action: "keep_cloud_record" }] };
  assert.equal(buildMigrationRequest(prepared(), "reviewed_merge", decisions).mergeDecisions, decisions);
  assert.throws(() => buildMigrationRequest(prepared(), "keep_cloud", decisions));
  assert.throws(() => buildMigrationRequest(prepared(), "unsupported"));
});
