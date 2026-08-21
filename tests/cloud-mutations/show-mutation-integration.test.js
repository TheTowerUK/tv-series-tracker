"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
function read(file) { return fs.readFileSync(path.resolve(__dirname, file), "utf8"); }

test("browser loads the cloud mutation stack before app integration", () => {
  const html = read("../../index.html");
  const mutation = html.indexOf('src="js/cloud-tracker-mutation-repository.js"');
  const sync = html.indexOf('src="js/cloud-tracker-sync.js"');
  const app = html.indexOf('src="js/app.js"');
  const review = html.indexOf('src="js/migration-review-ui.js"');
  assert.ok(mutation > 0 && mutation < sync && sync < app && app < review);
});

test("verified cutover supplies one controller and account generation to existing authority", () => {
  const ui = read("../../js/migration-review-ui.js");
  assert.match(ui, /createCloudTrackerMutationRepository\(\{ client \}\)/);
  assert.match(ui, /createCloudTrackerSync\(\{ cloudRepository, mutationRepository/);
  assert.match(ui, /authGeneration \+= 1/);
  assert.match(ui, /app\.setCloudWritable\(\{ controller: cloudSync, accountId, generation: authGeneration/);
  assert.match(ui, /showLocal\(\).*stateService\.applyAuthState/s);
});

test("cloud Add Edit and Delete route once through the controller without direct RPC", () => {
  const app = read("../../js/app.js");
  assert.match(app, /operation = current \? "updateShow" : "createShow"/);
  assert.match(app, /cloudController\.mutate\(\{\.\.\.cloudContext,operation,args,submitted/);
  assert.match(app, /operation:"deleteShow",args:\[show\]/);
  assert.equal((app.match(/cloudController\.mutate/g) || []).length, 2);
  assert.doesNotMatch(app, /\.rpc\s*\(/);
});

test("cloud metadata no-op closes normally before controller invocation", () => {
  const app = read("../../js/app.js");
  assert.match(app, /buildShowPatch\(current,record\)\)\{ els\.showDialog\.close\(\); return; \}/);
});

test("cloud writes never call the LocalStorage save path or mutate optimistically", () => {
  const app = read("../../js/app.js");
  const cloudBranch = app.slice(app.indexOf('if(authority === "cloud_ready"){', app.indexOf("async function saveEditor")), app.indexOf("const id = record.id"));
  assert.doesNotMatch(cloudBranch, /save\(\)|shows\.push|shows\[[^\]]+\]=|localRepository/);
  const deleteBranch = app.slice(app.indexOf('if(authority === "cloud_ready"){', app.indexOf("async function deleteCurrent")), app.indexOf('}else if(confirm', app.indexOf("async function deleteCurrent")));
  assert.doesNotMatch(deleteBranch, /save\(\)|shows\s*=\s*shows\.filter|localRepository/);
  assert.doesNotMatch(app, /removeItem\s*\(\s*["']tvSeriesTrackerData\.v1|localStorage\.clear\s*\(/);
});

test("existing local Add Edit Delete persistence remains in local branches", () => {
  const app = read("../../js/app.js");
  assert.match(app, /if\(index>=0\).*shows\[index\]=record.*else shows\.push\(record\).*save\(\)/s);
  assert.match(app, /Delete.*from this device.*shows = shows\.filter.*save\(\)/s);
});

test("cloud editing isolates metadata from deferred season mutations", () => {
  const app = read("../../js/app.js");
  assert.match(app, /editingCloudShow.*Boolean\(els\.showId\.value\)/);
  assert.match(app, /addSeasonBtn.*disabled = busy \|\| editingCloudShow/);
  assert.match(app, /season-status,.remove-season.*disabled = busy \|\| editingCloudShow/);
  assert.doesNotMatch(app, /operation:\s*["'](?:createSeason|updateSeason|deleteSeason)/);
});

test("busy stale and conflict states protect controls and expose read-only recovery", () => {
  const app = read("../../js/app.js"), html = read("../../index.html");
  for (const state of ["cloud_mutating", "cloud_refreshing", "cloud_conflict", "cloud_stale_readonly"]) assert.match(app, new RegExp(state));
  assert.match(app, /cloudController\.recover\(cloudContext\)/);
  assert.match(app, /cloudController\?\.clearConflict\(\)/);
  assert.match(html, /id="cloudSyncRetryBtn"/);
  assert.match(html, /id="cloudConflictDiscardBtn"/);
});

test("import reset and season RPC wiring remain outside cloud mode", () => {
  const app = read("../../js/app.js");
  assert.match(app, /function importJson\(file\)\{\s*if\(!file \|\| authority !== "local"\) return;/);
  assert.match(app, /function resetBaseline\(\)\{\s*if\(authority !== "local"\) return;/);
  assert.doesNotMatch(app, /tracker_restore_v2|BroadcastChannel|Realtime|tracker_(?:upsert|delete)_season/);
});
