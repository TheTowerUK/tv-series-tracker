"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
function read(file) { return fs.readFileSync(path.resolve(__dirname, file), "utf8"); }

test("missing Supabase configuration leaves migration integration inert and local startup available", () => {
  const ui = read("../../js/migration-review-ui.js");
  assert.match(ui, /const client = bootstrap\.getClient\(\);\s*if \(!client\) return;/);
  assert.match(read("../../js/app.js"), /createLocalTrackerRepository/);
});

test("fresh Auth inspection clears prior cloud authority before any new snapshot is accepted", () => {
  const ui = read("../../js/migration-review-ui.js");
  assert.match(ui, /STATES\.LOADING\) \{ showLocal\(\)/);
  assert.match(ui, /STATES\.CLOUD_ERROR\) \{ showLocal\(\)/);
  assert.match(ui, /STATES\.SOURCE_ERROR\) \{ showLocal\(\)/);
  assert.match(ui, /STATES\.CLOUD_READ_ONLY\).*app\.setCloudReadOnly/s);
});

test("all LocalStorage mutation entry points guard read-only authority", () => {
  const app = read("../../js/app.js");
  for (const name of ["saveEditor", "deleteCurrent", "importJson", "resetBaseline"]) {
    assert.match(app, new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]{0,80}authority !== \\\"local\\\"`));
  }
  assert.match(app, /showDialog,els\.detailDialog,els\.tmdbDialog/);
  assert.match(app, /setMutationControlsDisabled\(true\)/);
  assert.doesNotMatch(app, /removeItem\s*\(\s*["']tvSeriesTrackerData\.v1|localStorage\.clear\s*\(/);
});

test("recovery layer contains no cloud-write, restore, TMDB, credential or diagnostic path", () => {
  const files = ["../../js/migration-execution.js", "../../js/migration-marker.js", "../../js/migration-review-ui.js"].map(read).join("\n");
  assert.doesNotMatch(files, /tracker_(?:create|update|delete)_show|tracker_(?:upsert|delete)_season|tracker_restore_v2/);
  assert.doesNotMatch(files, /service.role|service_role|sb_secret_|JWT secret|SQLSTATE|SQLERRM|constraint_name/i);
});
