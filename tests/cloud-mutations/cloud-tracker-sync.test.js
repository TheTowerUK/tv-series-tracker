"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STATES, createCloudTrackerSync } = require("../../js/cloud-tracker-sync.js");

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const SHOW = "20000000-0000-4000-8000-000000000002";
function snapshot(title = "Before", revision = "1") {
  return { shows: [{ id: SHOW, title, revision, seasons: [] }], totals: { shows: 1, seasons: 0 } };
}
function successShow(title = "After", revision = "2") {
  return { ok: true, outcome: "success", data: { show: { id: SHOW, title, revision } }, conflict: null, error: null };
}
function harness({ mutationResult = successShow(), reads = [snapshot("After", "2")] } = {}) {
  const mutationCalls = [];
  const readCalls = [];
  const pending = [...reads];
  const mutations = {};
  for (const operation of ["createShow", "updateShow", "deleteShow", "createSeason", "updateSeason", "deleteSeason"]) {
    mutations[operation] = async (...args) => { mutationCalls.push({ operation, args }); return typeof mutationResult === "function" ? mutationResult() : mutationResult; };
  }
  const cloudRepository = { async readTracker() { readCalls.push(true); const value = pending.shift(); return typeof value === "function" ? value() : value && value.ok === false ? value : { ok: true, data: value }; } };
  const transitions = [];
  const sync = createCloudTrackerSync({ cloudRepository, mutationRepository: mutations, onStateChange: (state) => transitions.push(state.status) });
  sync.activate({ accountId: ACCOUNT, generation: 1, snapshot: snapshot() });
  return { sync, mutationCalls, readCalls, transitions };
}

test("success transitions through mutation and refresh without optimistic snapshot change", async () => {
  let finishMutation;
  const delayed = new Promise((resolve) => { finishMutation = resolve; });
  const h = harness({ mutationResult: () => delayed });
  const run = h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [{ revision: "1" }, { title: "After" }] });
  assert.equal(h.sync.getState().status, STATES.CLOUD_MUTATING);
  assert.equal(h.sync.getState().snapshot.shows[0].title, "Before");
  finishMutation(successShow());
  const result = await run;
  assert.equal(result.ok, true);
  assert.equal(h.sync.getState().status, STATES.CLOUD_READY);
  assert.equal(h.sync.getState().snapshot.shows[0].title, "After");
  assert.deepEqual(h.transitions, ["cloud_ready", "cloud_mutating", "cloud_refreshing", "cloud_ready"]);
  assert.equal(h.mutationCalls.length, 1);
  assert.equal(h.readCalls.length, 1);
});

test("serializes mutations and performs no retry", async () => {
  let finish;
  const h = harness({ mutationResult: () => new Promise((resolve) => { finish = resolve; }) });
  const first = h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [] });
  const second = await h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "deleteShow", args: [] });
  assert.equal(second.error.code, "cloud_mutation_unavailable");
  finish(successShow());
  await first;
  assert.equal(h.mutationCalls.length, 1);
});

test("conflict refreshes authoritatively, preserves submission, and clears explicitly", async () => {
  const conflictResult = { ok: false, outcome: "conflict", data: null, conflict: { kind: "revision", expectedRevision: "1", currentRevision: "2" }, error: null };
  const h = harness({ mutationResult: conflictResult, reads: [snapshot("Other device", "2")] });
  const result = await h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [{ revision: "1" }], submitted: { draft: { title: "Mine" } } });
  assert.equal(result.outcome, "conflict");
  assert.equal(h.sync.getState().status, STATES.CLOUD_CONFLICT);
  assert.equal(h.sync.getState().snapshot.shows[0].title, "Other device");
  assert.equal(h.sync.getState().conflict.submission.submitted.draft.title, "Mine");
  assert.equal(h.mutationCalls.length, 1);
  assert.equal(h.sync.clearConflict(), true);
  assert.equal(h.sync.getState().status, STATES.CLOUD_READY);
  assert.equal(h.sync.getState().conflict, null);
});

test("uncertain write, failed reread, and verification mismatch enter stale read-only", async () => {
  const scenarios = [
    harness({ mutationResult: { ok: false, outcome: "network_unavailable", data: null, conflict: null, error: { code: "network_unavailable" } } }),
    harness({ reads: [{ ok: false, error: { code: "network_unavailable" } }] }),
    harness({ reads: [snapshot("Wrong", "1")] })
  ];
  for (const h of scenarios) {
    const before = h.sync.getState().snapshot;
    await h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [] });
    assert.equal(h.sync.getState().status, STATES.CLOUD_STALE_READONLY);
    assert.equal(h.sync.getState().snapshot, before);
    const rejected = await h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "deleteShow", args: [] });
    assert.equal(rejected.error.code, "cloud_mutation_unavailable");
    assert.equal(h.mutationCalls.length, 1);
  }
});

test("stale recovery requires a successful fresh read and never retries mutation", async () => {
  const reads = [{ ok: false, error: { code: "offline" } }, { ok: false, error: { code: "offline" } }, snapshot("Recovered", "3")];
  const h = harness({ reads });
  await h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [] });
  assert.equal((await h.sync.recover({ accountId: ACCOUNT, generation: 1 })).outcome, "cloud_refresh_failed");
  assert.equal(h.sync.getState().status, STATES.CLOUD_STALE_READONLY);
  assert.equal((await h.sync.recover({ accountId: ACCOUNT, generation: 1 })).outcome, "success");
  assert.equal(h.sync.getState().status, STATES.CLOUD_READY);
  assert.equal(h.sync.getState().snapshot.shows[0].title, "Recovered");
  assert.equal(h.mutationCalls.length, 1);
});

test("account generation invalidates in-flight RPC and read results", async () => {
  let finishMutation;
  const h = harness({ mutationResult: () => new Promise((resolve) => { finishMutation = resolve; }) });
  const old = h.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [] });
  h.sync.activate({ accountId: "30000000-0000-4000-8000-000000000003", generation: 2, snapshot: { shows: [], totals: { shows: 0, seasons: 0 } } });
  finishMutation(successShow());
  assert.equal((await old).outcome, "operation_discarded");
  assert.equal(h.sync.getState().status, STATES.CLOUD_READY);
  assert.equal(h.sync.getState().snapshot.totals.shows, 0);

  let finishRead;
  const delayedRead = () => new Promise((resolve) => { finishRead = resolve; });
  const second = harness({ reads: [delayedRead] });
  const run = second.sync.mutate({ accountId: ACCOUNT, generation: 1, operation: "updateShow", args: [] });
  await Promise.resolve(); await Promise.resolve();
  second.sync.invalidate();
  finishRead({ ok: true, data: snapshot("Late", "2") });
  assert.equal((await run).outcome, "operation_discarded");
  assert.equal(second.sync.getState().status, STATES.INACTIVE);
});

test("source is DOM-free, storage-free, queue-free, and contains no automatic retry", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/cloud-tracker-sync.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.|querySelector|setTimeout|setInterval|BroadcastChannel|Realtime|tracker_migrate_v1|tracker_restore_v2/);
  assert.equal(fs.readFileSync(path.resolve(__dirname, "../../js/app.js"), "utf8").includes("cloud-tracker-sync"), false);
});
