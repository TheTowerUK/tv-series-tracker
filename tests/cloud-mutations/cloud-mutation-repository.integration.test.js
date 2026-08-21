"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { createCloudTrackerMutationRepository } = require("../../js/cloud-tracker-mutation-repository.js");

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

test("ordinary cloud mutations preserve RPC security, revisions, isolation, and cleanup", { skip: !enabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Local-only-${suffix}-A1!`;
  const users = [];
  try {
    const clients = [];
    for (const label of ["a", "b"]) {
      const email = `phase26-mutation-${label}-${suffix}@example.test`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(created.error, null);
      users.push(created.data.user);
      const client = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      assert.equal(signedIn.error, null);
      clients.push(client);
    }

    const first = createCloudTrackerMutationRepository({ client: clients[0] });
    const second = createCloudTrackerMutationRepository({ client: clients[1] });
    const created = await first.createShow({ platform: "Test", title: "Mutation integration", description: "Initial",
      posterUrl: "https://example.test/poster.jpg", tmdb: { id: 9123456, posterPath: "/tmdb.jpg" },
      seasons: [{ number: 1, status: "Not Started" }, { number: 2, status: "Watching" }] });
    assert.equal(created.outcome, "success");
    assert.equal(created.data.show.revision, "1");
    assert.equal(Array.from(created.data.seasons, (season) => season.revision).join(","), "1,1");

    const updated = await first.updateShow({ ...created.data.show, description: created.data.show.synopsis },
      { ...created.data.show, description: "Updated", tmdb: { id: 9123456, posterPath: "/tmdb.jpg" } });
    assert.equal(updated.outcome, "success");
    assert.equal(updated.data.show.revision, "2");

    const staleShow = await first.updateShow({ ...updated.data.show, revision: "1", description: updated.data.show.synopsis,
      tmdb: { id: 9123456, posterPath: "/tmdb.jpg" } }, { ...updated.data.show, revision: "1", description: "Stale", tmdb: { id: 9123456, posterPath: "/tmdb.jpg" } });
    assert.equal(staleShow.outcome, "conflict");
    assert.equal(staleShow.conflict.currentRevision, "2");

    const duplicateTmdb = await first.createShow({ platform: "Test", title: "Duplicate", tmdb: { id: 9123456 } });
    assert.equal(duplicateTmdb.outcome, "validation_error");
    assert.equal(duplicateTmdb.error.code, "duplicate_tmdb_id");

    const otherOwner = await second.updateShow({ id: created.data.show.id, revision: "2", platform: "Test", title: "Hidden", description: "", tmdb: null },
      { id: created.data.show.id, revision: "2", platform: "Test", title: "Forbidden", description: "", tmdb: null });
    assert.equal(otherOwner.outcome, "not_found");

    const seasonCreated = await first.createSeason(created.data.show, { number: 3, status: "Not Started" });
    assert.equal(seasonCreated.outcome, "success");
    assert.equal(seasonCreated.data.season.revision, "1");
    const createCollision = await first.createSeason(created.data.show, { number: 3, status: "Watching" });
    assert.equal(createCollision.outcome, "conflict");
    const seasonUpdated = await first.updateSeason(created.data.show, { ...seasonCreated.data.season, number: 3, status: "Completed" });
    assert.equal(seasonUpdated.outcome, "success");
    assert.equal(seasonUpdated.data.season.revision, "2");
    const staleSeason = await first.updateSeason(created.data.show, { ...seasonCreated.data.season, number: 3, status: "Watching" });
    assert.equal(staleSeason.outcome, "conflict");
    const seasonDeleted = await first.deleteSeason(created.data.show, { ...seasonUpdated.data.season, number: 3, status: "Completed" });
    assert.equal(seasonDeleted.outcome, "success");

    const denied = await clients[0].from("shows").insert({ platform: "Forged", title: "Denied" });
    assert.notEqual(denied.error, null);
    const deleted = await first.deleteShow({ ...updated.data.show, revision: "2" });
    assert.equal(deleted.outcome, "success");
    const remainingSeasons = await clients[0].from("season_progress").select("id", { count: "exact", head: true });
    assert.equal(remainingSeasons.count, 0);

    const serialized = JSON.stringify({ created, updated, staleShow, duplicateTmdb, otherOwner, createCollision, staleSeason });
    assert.doesNotMatch(serialized, /sqlstate|sqlerrm|constraint|index|query text|detail|hint/i);
  } finally {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (users.length) {
      const ids = users.map((user) => `'${user.id}'`).join(",");
      const sql = `select (select count(*) from public.shows where user_id in (${ids})) + (select count(*) from public.season_progress where user_id in (${ids})) + (select count(*) from public.migration_receipts where user_id in (${ids}));`;
      const count = execFileSync("docker", ["exec", process.env.TV_TRACKER_TEST_DB_CONTAINER || "supabase_db_TVSeriesTracker",
        "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
      assert.equal(count, "0");
    }
  }
});
