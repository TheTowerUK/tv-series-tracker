"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { createCloudTrackerRepository } = require("../../js/cloud-tracker-repository.js");
const { buildUpdateShowRequest, createCloudTrackerMutationRepository } = require("../../js/cloud-tracker-mutation-repository.js");
const { createCloudTrackerSync } = require("../../js/cloud-tracker-sync.js");

function loadSupabase() {
  const context = { AbortController, Blob, FormData, Headers, Request, Response, TextDecoder, TextEncoder,
    URL, URLSearchParams, atob, btoa, clearInterval, clearTimeout, console, crypto, fetch, setInterval, setTimeout };
  context.WebSocket = class LocalTestWebSocket {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../vendor/supabase-js/2.112.3/supabase.js"), "utf8"), context);
  return context.supabase;
}

const url = process.env.TV_TRACKER_TEST_SUPABASE_URL;
const publishableKey = process.env.TV_TRACKER_TEST_PUBLISHABLE_KEY;
const secretKey = process.env.TV_TRACKER_TEST_SECRET_KEY;
const enabled = Boolean(url && publishableKey && secretKey);

test("show integration confirms rereads, conflicts, stale recovery, cascade and local isolation", { skip: !enabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `phase26-show-flow-${suffix}@example.test`;
  const password = `Local-only-${suffix}-A1!`;
  const localTrackerSentinel = JSON.stringify({ schemaVersion: 1, shows: [{ id: "local-only", title: "Never dual-written" }] });
  let user = null;
  try {
    const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(createdUser.error, null); user = createdUser.data.user;
    const client = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
    const realReads = createCloudTrackerRepository({ client });
    const mutations = createCloudTrackerMutationRepository({ client });
    let failNextRead = false;
    const reads = { async readTracker() {
      if (failNextRead) { failNextRead = false; return { ok: false, data: null, error: { code: "network_unavailable" } }; }
      return realReads.readTracker();
    } };
    const initial = await reads.readTracker();
    const sync = createCloudTrackerSync({ cloudRepository: reads, mutationRepository: mutations });
    sync.activate({ accountId: user.id, generation: 1, snapshot: initial.data });

    const created = await sync.mutate({ accountId: user.id, generation: 1, operation: "createShow", args: [{ platform: "Test",
      title: "Cloud flow", description: "Initial", seasons: [{ number: 1, status: "Watching" }, { number: 2, status: "Not Started" }] }] });
    assert.equal(created.ok, true);
    let current = sync.getState().snapshot.shows[0];
    assert.equal(current.revision, "1");
    assert.equal(current.seasons.length, 2);

    const updated = await sync.mutate({ accountId: user.id, generation: 1, operation: "updateShow", args: [current, { ...current, title: "Cloud flow updated" }] });
    assert.equal(updated.ok, true);
    current = sync.getState().snapshot.shows[0];
    assert.equal(current.revision, "2");
    assert.equal(buildUpdateShowRequest(current, { ...current }), null);

    const external = await mutations.updateShow(current, { ...current, title: "Other device" });
    assert.equal(external.ok, true);
    const conflict = await sync.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [current, { ...current, title: "My stale draft" }], submitted: { draft: { title: "My stale draft" } } });
    assert.equal(conflict.outcome, "conflict");
    assert.equal(sync.getState().status, "cloud_conflict");
    assert.equal(sync.getState().conflict.submission.submitted.draft.title, "My stale draft");
    assert.equal(sync.getState().snapshot.shows[0].title, "Other device");
    assert.equal(sync.clearConflict(), true);

    current = sync.getState().snapshot.shows[0];
    failNextRead = true;
    const uncertain = await sync.mutate({ accountId: user.id, generation: 1, operation: "updateShow", args: [current, { ...current, title: "Committed but unread" }] });
    assert.equal(uncertain.outcome, "cloud_refresh_failed");
    assert.equal(sync.getState().status, "cloud_stale_readonly");
    assert.equal(sync.getState().snapshot.shows[0].title, "Other device");
    assert.equal((await sync.recover({ accountId: user.id, generation: 1 })).ok, true);
    current = sync.getState().snapshot.shows[0];
    assert.equal(current.title, "Committed but unread");
    assert.equal(current.revision, "4");

    const deleted = await sync.mutate({ accountId: user.id, generation: 1, operation: "deleteShow", args: [current] });
    assert.equal(deleted.ok, true);
    assert.deepEqual(sync.getState().snapshot.totals, { shows: 0, seasons: 0 });
    assert.equal(localTrackerSentinel, JSON.stringify({ schemaVersion: 1, shows: [{ id: "local-only", title: "Never dual-written" }] }));
  } finally {
    if (user) await admin.auth.admin.deleteUser(user.id);
    if (user) {
      const sql = `select (select count(*) from public.shows where user_id='${user.id}') + (select count(*) from public.season_progress where user_id='${user.id}') + (select count(*) from public.migration_receipts where user_id='${user.id}');`;
      const count = execFileSync("docker", ["exec", process.env.TV_TRACKER_TEST_DB_CONTAINER || "supabase_db_TVSeriesTracker",
        "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
      assert.equal(count, "0");
    }
  }
});
