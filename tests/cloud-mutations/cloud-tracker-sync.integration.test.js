"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { createCloudTrackerRepository } = require("../../js/cloud-tracker-repository.js");
const { createCloudTrackerMutationRepository } = require("../../js/cloud-tracker-mutation-repository.js");
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

test("sync controller accepts authority only from real owner-scoped post-mutation reread", { skip: !enabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `phase26-sync-${suffix}@example.test`;
  const password = `Local-only-${suffix}-A1!`;
  let user = null;
  try {
    const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(createdUser.error, null);
    user = createdUser.data.user;
    const client = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);

    const reads = createCloudTrackerRepository({ client });
    const mutations = createCloudTrackerMutationRepository({ client });
    const initial = await reads.readTracker();
    assert.equal(initial.ok, true);
    assert.deepEqual(initial.data.totals, { shows: 0, seasons: 0 });
    const transitions = [];
    const sync = createCloudTrackerSync({ cloudRepository: reads, mutationRepository: mutations,
      onStateChange: (state) => transitions.push(state.status) });
    sync.activate({ accountId: user.id, generation: 1, snapshot: initial.data });
    const result = await sync.mutate({ accountId: user.id, generation: 1, operation: "createShow",
      args: [{ platform: "Test", title: "Controller integration", seasons: [{ number: 1, status: "Watching" }] }],
      submitted: { draft: { title: "Controller integration" } } });
    assert.equal(result.ok, true);
    assert.equal(sync.getState().status, "cloud_ready");
    assert.deepEqual(sync.getState().snapshot.totals, { shows: 1, seasons: 1 });
    assert.equal(sync.getState().snapshot.shows[0].title, "Controller integration");
    assert.deepEqual(transitions, ["cloud_ready", "cloud_mutating", "cloud_refreshing", "cloud_ready"]);
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
