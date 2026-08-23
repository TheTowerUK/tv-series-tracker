import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CONTRACT_VERSION,
  MAX_CANDIDATES,
  TMDB_SEARCH_URL,
  createHandler,
  retryAfterSeconds,
  validateRequest
} from "../../supabase/functions/tmdb-search-tv/handler.mjs";

const allowedOrigin = "http://127.0.0.1:3000";
const token = "local-test-token-not-a-real-secret";

function request(body, options = {}) {
  const headers = new Headers({
    authorization: "Bearer local-user-jwt",
    "content-type": "application/json",
    origin: allowedOrigin,
    ...(options.headers || {})
  });
  return new Request("http://127.0.0.1:54321/functions/v1/tmdb-search-tv", {
    method: options.method || "POST",
    headers,
    body: options.method === "OPTIONS" ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

function tmdbResponse(results, status = 200, headers = {}) {
  return new Response(JSON.stringify({ page: 1, results }), { status, headers });
}

function candidate(id, overrides = {}) {
  return { id, name: `Show ${id}`, first_air_date: "2020-01-02", poster_path: `/p${id}.jpg`, overview: `Overview ${id}`, ...overrides };
}

async function json(response) {
  return { status: response.status, headers: response.headers, body: await response.json() };
}

test("strict request validation uses deterministic JSON Pointer fields", () => {
  assert.deepEqual(validateRequest(null).fields[0], { path: "", code: "object_required", message: "Request must be a JSON object." });
  assert.equal(validateRequest({ contractVersion: CONTRACT_VERSION, query: "Show", unexpected: true }).fields[0].path, "/unexpected");
  assert.equal(validateRequest({ contractVersion: "2", query: "Show" }).fields[0].path, "/contractVersion");
  assert.equal(validateRequest({ contractVersion: CONTRACT_VERSION, query: " " }).fields[0].path, "/query");
  assert.equal(validateRequest({ contractVersion: CONTRACT_VERSION, query: "Show", firstAirDate: "2023-02-29" }).fields[0].path, "/firstAirDate");
  assert.deepEqual(validateRequest({ contractVersion: CONTRACT_VERSION, query: "  Show  ", firstAirDate: null }).value,
    { query: "Show", firstAirDate: null });
});

test("anonymous, disallowed-origin, method, JSON and body failures are safe", async () => {
  const handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => assert.fail("upstream must not run") });
  let result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" }, { headers: { authorization: "" } })));
  assert.equal(result.status, 401); assert.equal(result.body.error.code, "unauthenticated");
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" }, { headers: { origin: "https://evil.invalid" } })));
  assert.equal(result.status, 403); assert.equal(result.headers.get("access-control-allow-origin"), null);
  result = await json(await handler(request({}, { method: "PUT" })));
  assert.equal(result.status, 405); assert.equal(result.body.error.code, "method_not_allowed");
  result = await json(await handler(request("{")));
  assert.equal(result.status, 400); assert.equal(result.body.error.fields[0].code, "invalid_json");
  result = await json(await handler(request("{}", { headers: { "content-type": "text/plain" } })));
  assert.equal(result.status, 400); assert.equal(result.body.error.fields[0].code, "invalid_content_type");
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "x".repeat(301) })));
  assert.equal(result.status, 400); assert.equal(result.body.error.fields[0].path, "/query");
});

test("controlled CORS answers allowed preflight without calling upstream", async () => {
  const handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => assert.fail("upstream must not run") });
  const response = await handler(request(null, { method: "OPTIONS" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/);
});

test("year-first search uses fixed parameters and skips fallback when candidates exist", async () => {
  const calls = [];
  const handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return tmdbResponse([candidate(10)]);
  } });
  const result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Doctor Who", firstAirDate: "2005-03-26" })));
  assert.equal(result.status, 200); assert.equal(result.body.data.fallbackUsed, false); assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(result.body.data, "query"), false);
  assert.equal(`${calls[0].url.origin}${calls[0].url.pathname}`, TMDB_SEARCH_URL);
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    query: "Doctor Who", include_adult: "false", language: "en-GB", page: "1", first_air_date_year: "2005"
  });
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
});

test("empty year result performs exactly one title-only fallback", async () => {
  const urls = [];
  const handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async (url) => {
    urls.push(new URL(url));
    return urls.length === 1 ? tmdbResponse([]) : tmdbResponse([candidate(20)]);
  } });
  const result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show", firstAirDate: "2020-01-01" })));
  assert.equal(result.status, 200); assert.equal(result.body.data.fallbackUsed, true); assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("first_air_date_year"), "2020");
  assert.equal(urls[1].searchParams.has("first_air_date_year"), false);
});

test("title-only search performs one request and returns at most eight normalized candidates", async () => {
  let calls = 0;
  const handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => {
    calls += 1; return tmdbResponse(Array.from({ length: 12 }, (_, index) => candidate(index + 1)));
  } });
  const result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(calls, 1); assert.equal(result.body.data.candidates.length, MAX_CANDIDATES);
  assert.deepEqual(Object.keys(result.body.data.candidates[0]), ["id", "name", "firstAirDate", "posterPath", "overview"]);
});

test("upstream errors, invalid responses and Retry-After are normalized without diagnostics", async () => {
  let handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () =>
    new Response("private upstream response", { status: 429, headers: { "retry-after": "99999", "x-private": "secret" } }) });
  let result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 429); assert.equal(result.body.error.code, "rate_limited"); assert.equal(result.body.error.retryAfterSeconds, 3600);
  assert.doesNotMatch(JSON.stringify(result.body), /private|token|x-private/i);

  handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => new Response("not json", { status: 200 }) });
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 502); assert.equal(result.body.error.code, "response_invalid");

  handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => tmdbResponse([candidate(1, { id: "bad" })]) });
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 502); assert.equal(result.body.error.code, "response_invalid");
});

test("missing secret and upstream credential failures disclose no credential detail", async () => {
  let handler = createHandler({ token: "", allowedOriginList: allowedOrigin, fetchImpl: async () => assert.fail("upstream must not run") });
  let result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 503); assert.equal(result.body.error.code, "configuration_unavailable");

  handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => new Response("bad token", { status: 401 }) });
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.body.error.code, "configuration_unavailable");
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(result.body), /bad token/i);
});

test("timeout and thrown upstream failures use stable safe outcomes", async () => {
  const abortingFetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("private timeout detail", "AbortError")));
  });
  let handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: abortingFetch, timeoutMs: 5 });
  let result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 504); assert.equal(result.body.error.code, "upstream_unavailable");

  handler = createHandler({ token, allowedOriginList: allowedOrigin, fetchImpl: async () => { throw new Error("private network detail"); } });
  result = await json(await handler(request({ contractVersion: CONTRACT_VERSION, query: "Show" })));
  assert.equal(result.status, 500); assert.equal(result.body.error.code, "internal_error");
  assert.doesNotMatch(JSON.stringify(result.body), /private network/i);
});

test("Retry-After supports HTTP dates and remains bounded", () => {
  assert.equal(retryAfterSeconds("120", 0), 120);
  assert.equal(retryAfterSeconds("Thu, 01 Jan 1970 00:00:30 GMT", 0), 30);
  assert.equal(retryAfterSeconds("invalid", 0), null);
});

test("runtime source contains no tracker database, service-role, logging, analytics or arbitrary-upstream path", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const handlerSource = fs.readFileSync(path.join(root, "supabase/functions/tmdb-search-tv/handler.mjs"), "utf8");
  const entrySource = fs.readFileSync(path.join(root, "supabase/functions/tmdb-search-tv/index.ts"), "utf8");
  const source = `${handlerSource}\n${entrySource}`;
  assert.doesNotMatch(source, /\.from\s*\(|\.rpc\s*\(|tracker_(?:create|update|delete|migrate|restore)|service[_-]?role|supabaseAdmin/i);
  assert.doesNotMatch(source, /console\.|analytics|query.history|localStorage|sessionStorage/i);
  assert.equal((handlerSource.match(/api\.themoviedb\.org\/3\/search\/tv/g) || []).length, 1);
  assert.doesNotMatch(entrySource, /SUPABASE_(?:SECRET|SERVICE)|DATABASE_URL/);
});
