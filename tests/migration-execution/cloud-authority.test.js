"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
function read(file) { return fs.readFileSync(path.resolve(__dirname, file), "utf8"); }

test("backup opportunity precedes confirmation and local source is never removed", () => {
  const html = read("../../index.html"), ui = read("../../js/migration-review-ui.js");
  assert.ok(html.indexOf('id="migrationBackupBtn"') < html.indexOf('id="migrationExecuteBtn"'));
  assert.match(ui, /app\.exportLocalBackup\(\)/);
  assert.doesNotMatch([read("../../js/migration-execution.js"), ui, read("../../js/app.js")].join("\n"),
    /removeItem\s*\(\s*["']tvSeriesTrackerData\.v1|localStorage\.clear\s*\(/);
});

test("cloud authority is read-only and no Phase 2.6 mutation RPC is present", () => {
  const app = read("../../js/app.js"), ui = read("../../js/migration-review-ui.js"), service = read("../../js/migration-execution.js");
  assert.match(app, /authority !== "local"/);
  assert.match(app, /setMutationControlsDisabled\(true\)/);
  assert.match(ui, /executionService\.clear\(\)/);
  assert.doesNotMatch(ui + service, /tracker_(?:create|update|delete)_show|tracker_(?:upsert|delete)_season|tracker_restore_v2/);
  assert.equal((service.match(/tracker_migrate_v1/g) || []).length > 0, true);
});
