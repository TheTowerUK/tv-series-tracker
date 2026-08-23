import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serviceModule = require("../../js/tmdb-search-service.js");

function bootstrap({ session = { user: { id: "owner" } }, invocation, state = "ready", sessionError = null } = {}) {
  const calls = [];
  const client = {
    auth: { async getSession() { return { data: { session }, error: sessionError }; } },
    functions: { async invoke(name, options) { calls.push({ name, options }); return invocation || success([]); } }
  };
  return {
    calls,
    value: { getState: () => ({ status: state }), getClient: () => client }
  };
}

function candidate(id = 1) {
  return { id, name: `Show ${id}`, firstAirDate: "2020-01-02", posterPath: `/p${id}.jpg`, overview: "Overview" };
}

function success(candidates, extras = {}) {
  return { data: { contractVersion: "1.0.0", outcome: "success", data: {
    requestedYear: 2020, fallbackUsed: false, candidates, ...extras
  }, error: null }, error: null };
}

function functionError(code, retryAfterSeconds = null) {
  const body = { contractVersion: "1.0.0", outcome: "error", data: null, error: { code, retryAfterSeconds, fields: [] } };
  return { data: null, error: { context: new Response(JSON.stringify(body), { status: 400, headers: { "content-type": "application/json" } }) } };
}

test("invokes only tmdb-search-tv with the exact contract request", async () => {
  const setup = bootstrap({ invocation: success([candidate()]) });
  const service = serviceModule.createTmdbSearchService({ bootstrap: setup.value });
  const result = await service.search(" Doctor Who ", "2005-03-26");
  assert.equal(result.ok, true);
  assert.deepEqual(setup.calls, [{ name: "tmdb-search-tv", options: { body: {
    contractVersion: "1.0.0", query: "Doctor Who", firstAirDate: "2005-03-26"
  } } }]);
});

test("requires an authenticated persisted session before invocation", async () => {
  const setup = bootstrap({ session: null });
  const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Doctor Who", null);
  assert.equal(result.outcome, "unauthenticated");
  assert.equal(setup.calls.length, 0);
});

test("normalizes success candidates and limits output to eight", async () => {
  const setup = bootstrap({ invocation: success(Array.from({ length: 10 }, (_, index) => candidate(index + 1)), { fallbackUsed: true }) });
  const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null);
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 8);
  assert.deepEqual(result.candidates[0], candidate(1));
  assert.deepEqual(Object.keys(result).sort(), ["candidates", "ok", "outcome", "retryAfterSeconds"]);
});

test("maps every stable Edge error without exposing response content", async () => {
  const mappings = new Map([
    ["invalid_request", "invalid_request"], ["unauthenticated", "unauthenticated"], ["rate_limited", "rate_limited"],
    ["upstream_unavailable", "upstream_unavailable"], ["response_invalid", "upstream_unavailable"],
    ["configuration_unavailable", "configuration_unavailable"], ["internal_error", "search_failed"]
  ]);
  for (const [code, expected] of mappings) {
    const setup = bootstrap({ invocation: functionError(code, code === "rate_limited" ? 90 : null) });
    const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null);
    assert.equal(result.outcome, expected);
    assert.equal(result.retryAfterSeconds, code === "rate_limited" ? 90 : null);
    assert.deepEqual(Object.keys(result).sort(), ["candidates", "ok", "outcome", "retryAfterSeconds"]);
  }
});

test("maps network rejection and never retries automatically", async () => {
  const setup = bootstrap();
  setup.value.getClient().functions.invoke = async (name, options) => {
    setup.calls.push({ name, options });
    throw new TypeError("fetch failed with private diagnostics");
  };
  const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null);
  assert.equal(result.outcome, "network_unavailable");
  assert.equal(setup.calls.length, 1);
});

test("normalizes gateway authorization failure when no function body is available", async () => {
  const setup = bootstrap({ invocation: { data: null, error: { context: new Response(null, { status: 401 }) } } });
  const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null);
  assert.equal(result.outcome, "unauthenticated");
  assert.equal(setup.calls.length, 1);
});

test("rejects invalid browser input and unavailable configuration without invoking", async () => {
  let setup = bootstrap();
  assert.equal((await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("", null)).outcome, "invalid_request");
  assert.equal(setup.calls.length, 0);
  setup = bootstrap({ state: "configuration_missing" });
  assert.equal((await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null)).outcome, "configuration_unavailable");
  assert.equal(setup.calls.length, 0);
});

test("rejects malformed success candidates safely", async () => {
  const setup = bootstrap({ invocation: success([{ ...candidate(), id: "private-upstream-value" }]) });
  const result = await serviceModule.createTmdbSearchService({ bootstrap: setup.value }).search("Example", null);
  assert.equal(result.outcome, "upstream_unavailable");
  assert.equal("data" in result, false);
});
