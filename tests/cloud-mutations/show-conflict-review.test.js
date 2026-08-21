"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createConflictModel } = require("../../js/show-conflict-review.js");
const { createCloudTrackerSync } = require("../../js/cloud-tracker-sync.js");
const { buildShowPatch } = require("../../js/cloud-tracker-mutation-repository.js");

function show(overrides = {}) {
  return { id: "show-id", platform: "TV", title: "Current", firstAirDate: "2024-01-01", description: "Cloud",
    posterUrl: "https://example.test/current.jpg", tmdb: { id: 4, posterPath: "/current.jpg" }, revision: "2", seasons: [], ...overrides };
}
function snapshot(current) { return { shows: current ? [current] : [], totals: { shows: current ? 1 : 0, seasons: 0 } }; }
function conflict(operation = "updateShow", current = show(), draft = show({ title: "Mine" })) {
  return { context: { accountId: "account", generation: 3 }, currentRecord: current,
    submission: { operation, args: [show({ revision: "1" }), draft], submitted: operation === "updateShow" ? { draft } : { title: "Current" } },
    result: { outcome: "conflict", conflict: { expectedRevision: "1", currentRevision: "2" } } };
}

test("compare model contains only editable metadata and marks unchanged values", () => {
  const model = createConflictModel(conflict());
  assert.equal(model.kind, "update");
  assert.deepEqual(model.fields.map((field) => field.key), ["platform", "title", "firstAirDate", "description", "posterUrl", "tmdbId", "tmdbPosterPath"]);
  assert.equal(model.fields.find((field) => field.key === "title").changed, true);
  assert.equal(model.fields.find((field) => field.key === "platform").changed, false);
  assert.doesNotMatch(JSON.stringify(model.fields), /revision|show-id|account/);
});

test("delete and already-removed conflicts expose no private identity in the view model", () => {
  assert.equal(createConflictModel(conflict("deleteShow")).kind, "delete");
  const removed = createConflictModel(conflict("deleteShow", null));
  assert.equal(removed.removed, true);
  assert.deepEqual(removed.fields, []);
});

test("review retry becomes a no-op when refreshed cloud already matches the draft", () => {
  const current = show({ title: "Already applied" });
  const model = createConflictModel(conflict("updateShow", current, { ...current }));
  assert.equal(buildShowPatch(model.current, model.proposed), null);
});

test("explicit review clears conflict without a write and retry uses fresh record", async () => {
  let current = show({ revision: "2" });
  const calls = [];
  const repository = {
    readTracker: async () => ({ ok: true, data: snapshot(current) }),
  };
  const mutations = {};
  for (const name of ["createShow", "createSeason", "updateSeason", "deleteSeason"]) mutations[name] = async () => ({ ok: false, outcome: "validation_error" });
  mutations.updateShow = async (base, draft) => {
    calls.push({ base, draft });
    if (calls.length === 1) return { ok: false, outcome: "conflict", conflict: { expectedRevision: "1", currentRevision: "2" } };
    current = show({ ...draft, id: current.id, revision: "3", seasons: [] });
    return { ok: true, outcome: "success", data: { show: current }, conflict: null, error: null };
  };
  mutations.deleteShow = async () => ({ ok: false, outcome: "validation_error" });
  const sync = createCloudTrackerSync({ cloudRepository: repository, mutationRepository: mutations });
  sync.activate({ accountId: "account", generation: 3, snapshot: snapshot(show({ revision: "1" })) });
  const draft = show({ revision: "1", title: "Mine" });
  await sync.mutate({ accountId: "account", generation: 3, operation: "updateShow", args: [show({ revision: "1" }), draft], submitted: { draft } });
  assert.equal(sync.getState().status, "cloud_conflict");
  assert.equal(sync.getState().conflict.currentRecord.revision, "2");
  assert.equal(sync.clearConflict(), true);
  assert.equal(calls.length, 1);
  await sync.mutate({ accountId: "account", generation: 3, operation: "updateShow", args: [current, draft], submitted: { draft } });
  assert.equal(calls[1].base.revision, "2");
  assert.equal(sync.getState().status, "cloud_ready");
});

test("failed conflict refresh hides review until recovery restores the same conflict", async () => {
  let fail = true;
  const repository = { readTracker: async () => fail ? (fail = false, { ok: false, error: { code: "network_unavailable" } }) : ({ ok: true, data: snapshot(show()) }) };
  const mutations = {};
  for (const name of ["createShow", "deleteShow", "createSeason", "updateSeason", "deleteSeason"]) mutations[name] = async () => ({ ok: false, outcome: "validation_error" });
  mutations.updateShow = async () => ({ ok: false, outcome: "conflict", conflict: { expectedRevision: "1", currentRevision: "2" } });
  const sync = createCloudTrackerSync({ cloudRepository: repository, mutationRepository: mutations });
  sync.activate({ accountId: "account", generation: 3, snapshot: snapshot(show({ revision: "1" })) });
  const draft = show({ title: "Mine", revision: "1" });
  await sync.mutate({ accountId: "account", generation: 3, operation: "updateShow", args: [show({ revision: "1" }), draft], submitted: { draft } });
  assert.equal(sync.getState().status, "cloud_stale_readonly");
  assert.equal(sync.getState().conflict.currentRecord, null);
  await sync.recover({ accountId: "account", generation: 3 });
  assert.equal(sync.getState().status, "cloud_conflict");
  assert.equal(sync.getState().conflict.currentRecord.revision, "2");
});

test("account change and session invalidation clear conflict and preserved draft", async () => {
  const repository = { readTracker: async () => ({ ok: true, data: snapshot(show()) }) };
  const mutations = {};
  for (const name of ["createShow", "deleteShow", "createSeason", "updateSeason", "deleteSeason"]) mutations[name] = async () => ({ ok: false, outcome: "validation_error" });
  mutations.updateShow = async () => ({ ok: false, outcome: "conflict", conflict: { expectedRevision: "1", currentRevision: "2" } });
  const sync = createCloudTrackerSync({ cloudRepository: repository, mutationRepository: mutations });
  const draft = show({ title: "Private draft", revision: "1" });
  sync.activate({ accountId: "first", generation: 1, snapshot: snapshot(show({ revision: "1" })) });
  await sync.mutate({ accountId: "first", generation: 1, operation: "updateShow", args: [show({ revision: "1" }), draft], submitted: { draft } });
  assert.equal(sync.getState().conflict.submission.submitted.draft.title, "Private draft");
  sync.activate({ accountId: "second", generation: 2, snapshot: snapshot(show()) });
  assert.equal(sync.getState().conflict, null);
  sync.invalidate();
  assert.deepEqual(sync.getState(), { status: "inactive", snapshot: null, conflict: null, recovery: null });
});

test("UI wiring has explicit actions and no diagnostics or automatic retry", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/show-conflict-review.js"), "utf8");
  const app = fs.readFileSync(path.resolve(__dirname, "../../js/app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  assert.match(html, /Use current cloud version/);
  assert.match(source + html, /Review my changes/);
  assert.match(app, /openEditor\(current,model\.kind==="update"\?model\.proposed:null\)/);
  assert.doesNotMatch(source + app, /SQLSTATE|SQLERRM|constraint|expectedRevision|currentRevision/);
  assert.doesNotMatch(source, /\.rpc\s*\(|setTimeout|setInterval/);
});
