"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CLIENT_OPTIONS,
  STATES,
  SupabaseBootstrapError,
  createSupabaseBootstrap,
  validateSupabaseConfig
} = require("../../js/supabase-bootstrap.js");

const VALID_CONFIG = Object.freeze({
  url: "https://example-project.supabase.co",
  publishableKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz"
});

function jwtForRole(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ role })}.signature`;
}

test("missing and placeholder configuration are safe non-ready states", () => {
  assert.deepEqual(validateSupabaseConfig(undefined), {
    ok: false,
    status: STATES.CONFIGURATION_MISSING,
    code: "supabase_config_missing"
  });
  assert.equal(validateSupabaseConfig({
    url: "https://YOUR_PROJECT_REF.supabase.co",
    publishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY"
  }).status, STATES.CONFIGURATION_PLACEHOLDER);
});

test("configuration has an exact key allow-list", () => {
  const result = validateSupabaseConfig({ ...VALID_CONFIG, serviceRoleKey: "not-allowed" });
  assert.equal(result.status, STATES.CONFIGURATION_INVALID);
  assert.equal(result.code, "supabase_config_keys_invalid");
});

test("hosted HTTPS and local HTTP browser configurations are accepted", () => {
  assert.equal(validateSupabaseConfig(VALID_CONFIG).ok, true);
  assert.equal(validateSupabaseConfig({
    url: "http://127.0.0.1:54321",
    publishableKey: "local-anon-key-value-long-enough"
  }).ok, true);
});

test("unsafe URLs are rejected", () => {
  for (const url of [
    "http://example.supabase.co",
    "https://user:password@example.supabase.co",
    "https://example.supabase.co/path",
    "https://example.supabase.co?key=value"
  ]) {
    assert.equal(validateSupabaseConfig({ ...VALID_CONFIG, url }).code, "supabase_url_invalid");
  }
});

test("obvious current and legacy privileged keys are rejected", () => {
  for (const publishableKey of [
    "sb_secret_abcdefghijklmnopqrstuvwxyz",
    "service_role_abcdefghijklmnopqrstuvwxyz",
    jwtForRole("service_role")
  ]) {
    const result = validateSupabaseConfig({ ...VALID_CONFIG, publishableKey });
    assert.equal(result.code, "supabase_secret_key_rejected");
  }
  assert.equal(validateSupabaseConfig({ ...VALID_CONFIG, publishableKey: jwtForRole("anon") }).ok, true);
});

test("bootstrap creates one client and is idempotent", () => {
  const calls = [];
  const expectedClient = Object.freeze({ kind: "supabase-client" });
  const bootstrap = createSupabaseBootstrap({
    createClient(...args) {
      calls.push(args);
      return expectedClient;
    }
  });

  assert.equal(bootstrap.initialize(VALID_CONFIG).status, STATES.READY);
  assert.equal(bootstrap.initialize(VALID_CONFIG).status, STATES.READY);
  assert.equal(calls.length, 1);
  assert.equal(bootstrap.getClient(), expectedClient);
  assert.deepEqual(calls[0][2], CLIENT_OPTIONS);
  assert.deepEqual(CLIENT_OPTIONS.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  });
});

test("invalid configuration never calls the client factory", () => {
  let called = false;
  const bootstrap = createSupabaseBootstrap({ createClient() { called = true; } });
  const result = bootstrap.initialize(undefined);
  assert.equal(result.status, STATES.CONFIGURATION_MISSING);
  assert.equal(called, false);
  assert.equal(bootstrap.getClient(), null);
});

test("library and generic initialization failures are normalized", () => {
  const missingLibrary = createSupabaseBootstrap({
    createClient() { throw new SupabaseBootstrapError("client_library_missing"); }
  });
  assert.equal(missingLibrary.initialize(VALID_CONFIG).status, STATES.CLIENT_LIBRARY_MISSING);

  const failed = createSupabaseBootstrap({ createClient() { throw new Error("private detail"); } });
  const result = failed.initialize(VALID_CONFIG);
  assert.equal(result.status, STATES.CLIENT_INITIALIZATION_FAILED);
  assert.equal(result.code, "supabase_client_initialization_failed");
  assert.equal(JSON.stringify(result).includes("private detail"), false);
});
