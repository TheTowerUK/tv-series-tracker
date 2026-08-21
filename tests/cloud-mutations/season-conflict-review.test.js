"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSeasonConflictModel } = require("../../js/season-conflict-review.js");

function season(number, status, revision = "2") { return { id: `season-${number}`, showId: "show", number, status, revision }; }
function conflict(operation, current, proposedStatus = "Completed", seasons = [season(1, "Watching"), current].filter(Boolean)) {
  return { context: { accountId: "account", generation: 1 }, currentRecord: current, parentRecord: { id: "show", seasons },
    submission: { operation, args: [{ id: "show" }, current || { number: 2, status: proposedStatus }], submitted: { proposedStatus } } };
}

test("status conflict exposes only current and proposed display status", () => {
  const model = createSeasonConflictModel(conflict("updateSeason", season(2, "Watching")));
  assert.equal(model.kind, "update");
  assert.equal(model.currentStatus, "Watching");
  assert.equal(model.proposedStatus, "Completed");
  assert.equal(model.isFinal, true);
});

test("delete conflict rechecks final-season rule from fresh parent", () => {
  const target = season(1, "Watching");
  const blocked = createSeasonConflictModel(conflict("deleteSeason", target, null, [target, season(2, "Not Started")]));
  assert.equal(blocked.kind, "delete");
  assert.equal(blocked.isFinal, false);
  const allowed = createSeasonConflictModel(conflict("deleteSeason", season(2, "Not Started")));
  assert.equal(allowed.isFinal, true);
});

test("create collision and removed season are safe non-retry models", () => {
  assert.equal(createSeasonConflictModel(conflict("createSeason", season(2, "Not Started"))).kind, "create");
  assert.equal(createSeasonConflictModel(conflict("deleteSeason", null)).removed, true);
});

test("application season routes are explicit, non-optimistic, and LocalStorage-isolated", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../../js/app.js"), "utf8");
  assert.match(app, /operation:"createSeason",args:\[show,season\]/);
  assert.match(app, /operation:"updateSeason",args:\[show,\{\.\.\.season,status:proposedStatus\}\]/);
  assert.match(app, /operation:"deleteSeason",args:\[show,season\]/);
  assert.match(app, /select\.value=season\.status/);
  assert.match(app, /if\(proposedStatus===season\.status\) return/);
  assert.match(app, /if\(number!==maximum\).*return;/s);
  for (const name of ["addCloudSeason", "changeCloudSeasonStatus", "deleteCloudSeason"]) {
    const start = app.indexOf(`function ${name}`);
    const body = app.slice(start, app.indexOf("\n  }", start) + 4);
    assert.doesNotMatch(body, /save\(\)|localRepository|shows\s*=|\.push\(/);
  }
  assert.doesNotMatch(app, /tracker_(?:upsert|delete)_season/);
});

test("season conflict UI has explicit review and retry without diagnostics", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/season-conflict-review.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  assert.match(html, /Use current cloud status/);
  assert.match(source + html, /Review my change/);
  assert.match(source + html, /Apply reviewed change/);
  assert.doesNotMatch(source, /\.rpc\s*\(|SQLSTATE|SQLERRM|expectedRevision|currentRevision|setTimeout|setInterval/);
});
