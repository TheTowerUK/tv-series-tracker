import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTmdbSearchService } = require("../../js/tmdb-search-service.js");

const functionUrl = process.env.TV_TRACKER_TEST_FUNCTION_URL;
const publishableKey = process.env.TV_TRACKER_TEST_PUBLISHABLE_KEY;
const accessToken = process.env.TV_TRACKER_TEST_ACCESS_TOKEN;
const enabled = Boolean(functionUrl && publishableKey);
const supabaseUrl = process.env.TV_TRACKER_TEST_SUPABASE_URL;
const secretKey = process.env.TV_TRACKER_TEST_SECRET_KEY;
const liveEnabled = process.env.TV_TRACKER_TEST_LIVE_TMDB === "true" && Boolean(supabaseUrl && publishableKey && secretKey);

function loadSupabase() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const context = { AbortController, Blob, FormData, Headers, Request, Response, TextDecoder, TextEncoder,
    URL, URLSearchParams, atob, btoa, clearInterval, clearTimeout, console, crypto, fetch, setInterval, setTimeout };
  context.WebSocket = class LocalTestWebSocket {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "vendor/supabase-js/2.112.3/supabase.js"), "utf8"), context);
  return context.supabase;
}

test("local Edge gateway denies anonymous invocation", { skip: !enabled }, async () => {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "1.0.0", query: "Doctor Who" })
  });
  assert.equal(response.status, 401);
});

test("local authenticated invocation reaches strict function validation", { skip: !(enabled && accessToken) }, async () => {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "1.0.0", query: "" })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.contractVersion, "1.0.0");
  assert.equal(body.error.code, "invalid_request");
  assert.equal(body.error.fields[0].path, "/query");
});

test("local authenticated browser service receives normalized live candidates", { skip: !liveEnabled }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `tmdb-browser-${suffix}@example.test`;
  const password = `Local-only-${suffix}-A1!`;
  let userId = null;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    userId = created.data.user.id;
    const client = supabase.createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(signedIn.error, null);
    const bootstrap = { getState: () => ({ status: "ready" }), getClient: () => client };
    const result = await createTmdbSearchService({ bootstrap }).search("Doctor Who", "2005-03-26");
    assert.equal(result.ok, true);
    assert.ok(result.candidates.length >= 1 && result.candidates.length <= 8);
    for (const candidate of result.candidates) {
      assert.deepEqual(Object.keys(candidate).sort(), ["firstAirDate", "id", "name", "overview", "posterPath"]);
    }
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
