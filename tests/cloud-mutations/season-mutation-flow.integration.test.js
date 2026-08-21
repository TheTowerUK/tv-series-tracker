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

test("season flow confirms add, update, conflicts, explicit retry, final deletion and cleanup", { skip: !enabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `phase26-season-flow-${suffix}@example.test`;
  const password = `Local-only-${suffix}-A1!`;
  const localSentinel = "unchanged-local-season-data";
  let user = null;
  try {
    const createdUser = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(createdUser.error, null); user = createdUser.data.user;
    const clientA = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const clientB = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.equal((await clientA.auth.signInWithPassword({ email, password })).error, null);
    assert.equal((await clientB.auth.signInWithPassword({ email, password })).error, null);
    const reads = createCloudTrackerRepository({ client: clientA });
    const mutationsA = createCloudTrackerMutationRepository({ client: clientA });
    const mutationsB = createCloudTrackerMutationRepository({ client: clientB });
    const sync = createCloudTrackerSync({ cloudRepository: reads, mutationRepository: mutationsA });
    sync.activate({ accountId: user.id, generation: 1, snapshot: (await reads.readTracker()).data });

    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "createShow", args: [{ platform: "Test", title: "Season flow",
      seasons: [{ number: 1, status: "Not Started" }, { number: 2, status: "Watching" }] }] })).ok, true);
    let show = sync.getState().snapshot.shows[0];
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "createSeason",
      args: [show, { number: 3, status: "Not Started" }], submitted: { proposedStatus: "Not Started", seasonNumber: 3 } })).ok, true);
    show = sync.getState().snapshot.shows[0];
    let season3 = show.seasons.find((season) => season.number === 3);
    assert.equal(season3.revision, "1");

    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "updateSeason",
      args: [show, { ...season3, status: "Watching" }], submitted: { proposedStatus: "Watching", seasonNumber: 3 } })).ok, true);
    show = sync.getState().snapshot.shows[0]; season3 = show.seasons.find((season) => season.number === 3);
    assert.equal(season3.revision, "2");

    assert.equal((await mutationsB.updateSeason(show, { ...season3, status: "Completed" })).ok, true);
    const proposed = "Purchase Only";
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "updateSeason",
      args: [show, { ...season3, status: proposed }], submitted: { proposedStatus: proposed, seasonNumber: 3 } })).outcome, "conflict");
    let conflict = sync.getState().conflict;
    assert.equal(conflict.currentRecord.revision, "3");
    assert.equal(conflict.currentRecord.status, "Completed");
    assert.equal(conflict.submission.submitted.proposedStatus, proposed);
    const parentForRetry = conflict.parentRecord, seasonForRetry = conflict.currentRecord;
    sync.clearConflict();
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "updateSeason",
      args: [parentForRetry, { ...seasonForRetry, status: proposed }], submitted: { proposedStatus: proposed, seasonNumber: 3 } })).ok, true);
    show = sync.getState().snapshot.shows[0]; season3 = show.seasons.find((season) => season.number === 3);
    assert.equal(season3.revision, "4");

    assert.equal((await mutationsB.createSeason(show, { number: 4, status: "Not Started" })).ok, true);
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "createSeason",
      args: [show, { number: 4, status: "Not Started" }], submitted: { proposedStatus: "Not Started", seasonNumber: 4 } })).outcome, "conflict");
    conflict = sync.getState().conflict;
    assert.equal(conflict.currentRecord.number, 4);
    sync.clearConflict();
    show = sync.getState().snapshot.shows[0];
    const season4 = show.seasons.find((season) => season.number === 4);
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "deleteSeason", args: [show, season4] })).ok, true);

    show = sync.getState().snapshot.shows[0]; season3 = show.seasons.find((season) => season.number === 3);
    assert.equal((await mutationsB.updateSeason(show, { ...season3, status: "Region Blocked" })).ok, true);
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "deleteSeason",
      args: [show, season3], submitted: { seasonNumber: 3 } })).outcome, "conflict");
    conflict = sync.getState().conflict;
    assert.equal(conflict.currentRecord.revision, "5");
    assert.equal(Math.max(...conflict.parentRecord.seasons.map((season) => season.number)), 3);
    sync.clearConflict();
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "deleteSeason",
      args: [conflict.parentRecord, conflict.currentRecord] })).ok, true);
    show = sync.getState().snapshot.shows[0];
    assert.deepEqual(show.seasons.map((season) => season.number), [1, 2]);
    assert.equal((await sync.mutate({ accountId: user.id, generation: 1, operation: "deleteShow", args: [show] })).ok, true);
    assert.equal(sync.getState().snapshot.totals.seasons, 0);
    assert.equal(localSentinel, "unchanged-local-season-data");
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
