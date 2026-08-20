"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { V1_MIGRATION_KEY, createCloudTrackerRepository } = require("../../js/cloud-tracker-repository.js");

function loadVendoredSupabase() {
  const context = {
    AbortController, Blob, FormData, Headers, Request, Response, TextDecoder, TextEncoder,
    URL, URLSearchParams, atob, btoa, clearInterval, clearTimeout, console, crypto, fetch,
    setInterval, setTimeout
  };
  context.WebSocket = class LocalTestWebSocket {};
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.resolve(__dirname, "../../vendor/supabase-js/2.112.3/supabase.js"), "utf8");
  vm.runInContext(source, context);
  return context.supabase;
}

const url = process.env.TV_TRACKER_TEST_SUPABASE_URL;
const publishableKey = process.env.TV_TRACKER_TEST_PUBLISHABLE_KEY;
const secretKey = process.env.TV_TRACKER_TEST_SECRET_KEY;
const enabled = Boolean(url && publishableKey && secretKey);

test("local Supabase reads remain owner-scoped across tracker and receipt rows", { skip: !enabled }, async () => {
  const supabase = loadVendoredSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Local-only-${suffix}-A1!`;
  const users = [];

  try {
    for (const label of ["a", "b"]) {
      const email = `phase25-read-${label}-${suffix}@example.test`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(created.error, null);
      users.push({ id: created.data.user.id, email });
    }

    const clients = [];
    for (const user of users) {
      const client = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await client.auth.signInWithPassword({ email: user.email, password });
      assert.equal(signedIn.error, null);
      clients.push(client);
    }

    const showIds = users.map(() => randomUUID());
    const seasonIds = users.map(() => randomUUID());
    const fixtureSql = `
      insert into public.shows (id,user_id,platform,title)
      values ('${showIds[0]}','${users[0].id}','TV','Owner 1 private show'),
             ('${showIds[1]}','${users[1].id}','TV','Owner 2 private show');
      insert into public.season_progress (id,show_id,user_id,season_number,status)
      values ('${seasonIds[0]}','${showIds[0]}','${users[0].id}',1,'not_started'),
             ('${seasonIds[1]}','${showIds[1]}','${users[1].id}',1,'not_started');
      insert into public.migration_receipts
        (user_id,migration_key,source_schema_version,source_checksum,result_checksum,imported_show_count,imported_season_count)
      values ('${users[0].id}','${V1_MIGRATION_KEY}',1,'${"a".repeat(64)}','${"a".repeat(64)}',1,1);
    `;
    execFileSync("docker", [
      "exec", process.env.TV_TRACKER_TEST_DB_CONTAINER || "supabase_db_TVSeriesTracker",
      "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", fixtureSql
    ], { stdio: "pipe" });

    const first = createCloudTrackerRepository({ client: clients[0], pageSize: 500 });
    const second = createCloudTrackerRepository({ client: clients[1], pageSize: 500 });
    const firstTracker = await first.readTracker();
    const secondTracker = await second.readTracker();
    assert.equal(firstTracker.ok, true);
    assert.equal(secondTracker.ok, true);
    assert.deepEqual(firstTracker.data.shows.map((show) => show.title), ["Owner 1 private show"]);
    assert.deepEqual(secondTracker.data.shows.map((show) => show.title), ["Owner 2 private show"]);
    assert.equal((await first.readMigrationReceipt()).data.receipt.migrationKey, V1_MIGRATION_KEY);
    assert.equal((await second.readMigrationReceipt()).data.receipt, null);
  } finally {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  }
});
