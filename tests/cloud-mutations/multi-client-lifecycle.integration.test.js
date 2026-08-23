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

test("two independent clients use revisions for show and season correctness", { skip: !enabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `phase26-two-client-${suffix}@example.test`;
  const password = `Local-only-${suffix}-A1!`;
  let user = null;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null); user = created.data.user;
    const clientA = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const clientB = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.equal((await clientA.auth.signInWithPassword({ email, password })).error, null);
    assert.equal((await clientB.auth.signInWithPassword({ email, password })).error, null);
    const readsA = createCloudTrackerRepository({ client: clientA });
    const readsB = createCloudTrackerRepository({ client: clientB });
    const syncA = createCloudTrackerSync({ cloudRepository: readsA,
      mutationRepository: createCloudTrackerMutationRepository({ client: clientA }) });
    const syncB = createCloudTrackerSync({ cloudRepository: readsB,
      mutationRepository: createCloudTrackerMutationRepository({ client: clientB }) });
    syncA.activate({ accountId: user.id, generation: 1, snapshot: (await readsA.readTracker()).data });

    assert.equal((await syncA.mutate({ accountId: user.id, generation: 1, operation: "createShow", args: [{ platform: "Test",
      title: "Two client lifecycle", seasons: [{ number: 1, status: "Not Started" }, { number: 2, status: "Watching" }] }] })).ok, true);
    syncB.activate({ accountId: user.id, generation: 1, snapshot: (await readsB.readTracker()).data });
    let aShow = syncA.getState().snapshot.shows[0];
    let bShow = syncB.getState().snapshot.shows[0];

    assert.equal((await syncA.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [aShow, { ...aShow, title: "Device A revision 2" }] })).ok, true);
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [bShow, { ...bShow, description: "Device B stale draft" }], submitted: { draft: "device-b" } })).outcome, "conflict");
    assert.equal(syncB.getState().snapshot.shows[0].revision, "2");
    bShow = syncB.getState().conflict.currentRecord;
    syncB.clearConflict();
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [bShow, { ...bShow, description: "Device B reviewed" }] })).ok, true);
    assert.equal(syncB.getState().snapshot.shows[0].revision, "3");

    aShow = syncA.getState().snapshot.shows[0];
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [aShow, { ...aShow, title: "Still stale" }] })).outcome, "conflict");
    assert.equal(syncA.getState().snapshot.shows[0].description, "Device B reviewed");
    const deleteTarget = syncA.getState().conflict.currentRecord;
    syncA.clearConflict();
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 1, operation: "updateShow",
      args: [syncB.getState().snapshot.shows[0], { ...syncB.getState().snapshot.shows[0], title: "Device B revision 4" }] })).ok, true);
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 1, operation: "deleteShow",
      args: [deleteTarget] })).outcome, "conflict");
    assert.equal(syncA.getState().conflict.currentRecord.revision, "4");
    syncA.clearConflict();

    syncA.activate({ accountId: user.id, generation: 2, snapshot: (await readsA.readTracker()).data });
    syncB.activate({ accountId: user.id, generation: 2, snapshot: (await readsB.readTracker()).data });
    aShow = syncA.getState().snapshot.shows[0]; bShow = syncB.getState().snapshot.shows[0];
    const aSeason2 = aShow.seasons.find((season) => season.number === 2);
    const bSeason2 = bShow.seasons.find((season) => season.number === 2);
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 2, operation: "updateSeason",
      args: [aShow, { ...aSeason2, status: "Completed" }] })).ok, true);
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 2, operation: "updateSeason",
      args: [bShow, { ...bSeason2, status: "Purchase Only" }] })).outcome, "conflict");
    const seasonConflict = syncB.getState().conflict;
    syncB.clearConflict();
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 2, operation: "updateSeason",
      args: [seasonConflict.parentRecord, { ...seasonConflict.currentRecord, status: "Purchase Only" }] })).ok, true);

    syncA.activate({ accountId: user.id, generation: 3, snapshot: (await readsA.readTracker()).data });
    syncB.activate({ accountId: user.id, generation: 3, snapshot: (await readsB.readTracker()).data });
    aShow = syncA.getState().snapshot.shows[0]; bShow = syncB.getState().snapshot.shows[0];
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 3, operation: "createSeason",
      args: [aShow, { number: 3, status: "Not Started" }] })).ok, true);
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 3, operation: "createSeason",
      args: [bShow, { number: 3, status: "Not Started" }] })).outcome, "conflict");
    assert.equal(syncB.getState().snapshot.shows[0].seasons.length, 3);
    syncB.clearConflict();

    syncA.activate({ accountId: user.id, generation: 4, snapshot: (await readsA.readTracker()).data });
    syncB.activate({ accountId: user.id, generation: 4, snapshot: (await readsB.readTracker()).data });
    aShow = syncA.getState().snapshot.shows[0]; bShow = syncB.getState().snapshot.shows[0];
    const aSeason3 = aShow.seasons.find((season) => season.number === 3);
    const bSeason3 = bShow.seasons.find((season) => season.number === 3);
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 4, operation: "updateSeason",
      args: [aShow, { ...aSeason3, status: "Region Blocked" }] })).ok, true);
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 4, operation: "deleteSeason",
      args: [bShow, bSeason3] })).outcome, "conflict");
    const finalDelete = syncB.getState().conflict;
    syncB.clearConflict();
    assert.equal((await syncB.mutate({ accountId: user.id, generation: 4, operation: "deleteSeason",
      args: [finalDelete.parentRecord, finalDelete.currentRecord] })).ok, true);
    assert.deepEqual(syncB.getState().snapshot.shows[0].seasons.map((season) => season.number), [1, 2]);

    syncA.activate({ accountId: user.id, generation: 5, snapshot: (await readsA.readTracker()).data });
    assert.equal(syncA.getState().snapshot.shows[0].seasons.find((season) => season.number === 2).status, "Purchase Only");
    assert.equal(syncA.getState().snapshot.shows[0].title, "Device B revision 4");
    assert.equal((await syncA.mutate({ accountId: user.id, generation: 5, operation: "deleteShow",
      args: [syncA.getState().snapshot.shows[0]] })).ok, true);
    assert.deepEqual(syncA.getState().snapshot.totals, { shows: 0, seasons: 0 });
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
