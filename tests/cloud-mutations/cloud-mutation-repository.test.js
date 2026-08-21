"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ENVELOPE_KEYS, RPC, STATUS_TO_DATABASE, buildCreateShowRequest, buildDeleteSeasonRequest,
  buildDeleteShowRequest, buildShowPatch, buildUpdateShowRequest, buildUpsertSeasonRequest,
  createCloudTrackerMutationRepository, normalizeRpcResult
} = require("../../js/cloud-tracker-mutation-repository.js");

const SHOW_ID = "10000000-0000-4000-8000-000000000001";
const hugeRevision = "9007199254740993";
const baseShow = Object.freeze({ id: SHOW_ID, platform: "TV", title: "Example", firstAirDate: null,
  description: "Synopsis", posterUrl: null, tmdb: null, seasons: [], revision: hugeRevision });
const baseSeason = Object.freeze({ id: "20000000-0000-4000-8000-000000000002", showId: SHOW_ID, number: 1,
  status: "Not Started", revision: hugeRevision });

function envelope(operation, outcome = "success", data = {}) {
  return { contractVersion: "2.0.0", outcome, operation, entity: "show", entityId: SHOW_ID,
    data: outcome === "success" ? data : null, conflict: outcome === "conflict" ? { kind: "revision", expectedRevision: "1", currentRevision: "2" } : null,
    error: ["validation_error", "not_found", "internal_error"].includes(outcome) ? { code: outcome } : null };
}

function fakeClient(handler = (name) => ({ data: envelope(name), error: null })) {
  const calls = [];
  return { calls, async rpc(name, args) { calls.push({ name, args }); return handler(name, args); } };
}

test("builds create request with initial seasons and excludes server-owned fields", () => {
  const request = buildCreateShowRequest({ ...baseShow, id: "forged", userId: "forged", createdAt: "forged", legacyId: "forged",
    firstAirDate: " ", posterUrl: " ", tmdb: { id: 42, posterPath: "/tmdb.jpg" }, seasons: [{ number: 1, status: "Watching", revision: "99" }] });
  assert.deepEqual(request, { platform: "TV", title: "Example", firstAirDate: null, synopsis: "Synopsis", posterUrl: null,
    tmdbId: 42, tmdbPosterPath: "/tmdb.jpg", seasons: [{ number: 1, status: "watching" }] });
  for (const key of ["id", "userId", "legacyId", "createdAt", "updatedAt", "revision"]) assert.equal(key in request, false);
});

test("builds create request without optional values and preserves poster independence", () => {
  assert.deepEqual(buildCreateShowRequest({ platform: " TV ", title: " Example ", description: null, tmdb: { id: 7, posterPath: null } }),
    { platform: "TV", title: "Example", firstAirDate: null, synopsis: "", posterUrl: null, tmdbId: 7, tmdbPosterPath: null });
  const withPoster = buildCreateShowRequest({ platform: "TV", title: "Example", posterUrl: "https://img.test/custom.jpg", tmdb: { id: null, posterPath: "/tmdb.jpg" } });
  assert.equal(withPoster.posterUrl, "https://img.test/custom.jpg");
  assert.equal(withPoster.tmdbPosterPath, "/tmdb.jpg");
});

test("builds only materially changed show fields and reports an empty patch", () => {
  assert.equal(buildShowPatch(baseShow, { ...baseShow }), null);
  assert.equal(buildUpdateShowRequest(baseShow, { ...baseShow }), null);
  assert.deepEqual(buildUpdateShowRequest(baseShow, { ...baseShow, description: "Changed", posterUrl: " " }),
    { showId: SHOW_ID, expectedRevision: hugeRevision, showPatch: { synopsis: "Changed" } });
});

test("builds delete and season requests with decimal-string revisions", () => {
  assert.deepEqual(buildDeleteShowRequest(baseShow), { showId: SHOW_ID, expectedRevision: hugeRevision });
  assert.deepEqual(buildUpsertSeasonRequest(baseShow, baseSeason, { create: true }), { showId: SHOW_ID, seasonNumber: 1, expectedRevision: null, status: "not_started" });
  assert.deepEqual(buildUpsertSeasonRequest(baseShow, { ...baseSeason, status: "Completed" }), { showId: SHOW_ID, seasonNumber: 1, expectedRevision: hugeRevision, status: "completed" });
  assert.deepEqual(buildDeleteSeasonRequest(baseShow, baseSeason), { showId: SHOW_ID, seasonNumber: 1, expectedRevision: hugeRevision });
  assert.throws(() => buildDeleteShowRequest({ ...baseShow, revision: 9007199254740993 }), /decimal string/);
});

test("maps all five UI statuses exactly", () => {
  assert.deepEqual(STATUS_TO_DATABASE, { "Not Started": "not_started", Watching: "watching", Completed: "completed", "Purchase Only": "purchase_only", "Region Blocked": "region_blocked" });
  for (const [label, status] of Object.entries(STATUS_TO_DATABASE)) assert.equal(buildUpsertSeasonRequest(baseShow, { ...baseSeason, status: label }).status, status);
});

test("calls only the five approved ordinary RPCs with exact request wrappers and never retries", async () => {
  const client = fakeClient();
  const repo = createCloudTrackerMutationRepository({ client });
  await repo.createShow(baseShow);
  await repo.updateShow(baseShow, { ...baseShow, title: "Changed" });
  await repo.deleteShow(baseShow);
  await repo.createSeason(baseShow, baseSeason);
  await repo.updateSeason(baseShow, baseSeason);
  await repo.deleteSeason(baseShow, baseSeason);
  assert.deepEqual(client.calls.map((call) => call.name), [RPC.createShow, RPC.updateShow, RPC.deleteShow, RPC.upsertSeason, RPC.upsertSeason, RPC.deleteSeason]);
  assert.equal(client.calls.every((call) => Object.keys(call.args).join() === "request"), true);
  assert.deepEqual(repo.capabilities, { trackerWrite: true, automaticRetry: false, postWriteRefresh: false });
  const before = client.calls.length;
  const noOp = await repo.updateShow(baseShow, { ...baseShow });
  assert.equal(noOp.noOp, true);
  assert.equal(client.calls.length, before);
});

test("strictly validates envelopes and revision representation", () => {
  const good = normalizeRpcResult({ data: envelope(RPC.updateShow, "success", { show: { revision: hugeRevision } }), error: null }, RPC.updateShow);
  assert.equal(good.ok, true);
  const extra = envelope(RPC.updateShow); extra.extra = true;
  assert.equal(normalizeRpcResult({ data: extra, error: null }, RPC.updateShow).outcome, "internal_error");
  assert.equal(normalizeRpcResult({ data: envelope("wrong"), error: null }, RPC.updateShow).outcome, "internal_error");
  assert.equal(normalizeRpcResult({ data: envelope(RPC.updateShow, "success", { show: { revision: 1 } }), error: null }, RPC.updateShow).outcome, "internal_error");
  assert.deepEqual(Object.keys(envelope(RPC.createShow)).sort(), [...ENVELOPE_KEYS]);
});

test("normalizes every outcome and discloses no raw diagnostics", async () => {
  for (const outcome of ["conflict", "validation_error", "not_found", "internal_error"]) {
    const result = normalizeRpcResult({ data: envelope(RPC.updateShow, outcome), error: null }, RPC.updateShow);
    assert.equal(result.outcome, outcome);
  }
  const hostileConflict = envelope(RPC.updateShow, "conflict");
  hostileConflict.conflict.sqlstate = "23505"; hostileConflict.conflict.detail = "private constraint";
  assert.doesNotMatch(JSON.stringify(normalizeRpcResult({ data: hostileConflict, error: null }, RPC.updateShow)), /sqlstate|constraint|23505/i);
  const authEnvelope = envelope(RPC.updateShow, "internal_error"); authEnvelope.error.code = "auth_context_missing";
  assert.equal(normalizeRpcResult({ data: authEnvelope, error: null }, RPC.updateShow).outcome, "unauthenticated");
  const cases = [[{ status: 401, message: "JWT expired secret" }, "unauthenticated"], [{ status: 403, message: "permission denied secret" }, "forbidden"],
    [new TypeError("Failed to fetch secret"), "network_unavailable"], [{ status: 500, message: "SQLSTATE 23505 constraint private" }, "internal_error"]];
  for (const [error, outcome] of cases) {
    const result = normalizeRpcResult({ data: null, error }, RPC.createShow);
    assert.equal(result.outcome, outcome);
    assert.doesNotMatch(JSON.stringify(result), /secret|sqlstate|constraint|23505/i);
  }
});

test("source has no DOM, storage, migration/restore RPC, retry, or post-write mutation", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/cloud-tracker-mutation-repository.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.querySelector|tracker_migrate_v1|tracker_restore_v2|setTimeout|setInterval/);
  assert.equal(fs.readFileSync(path.resolve(__dirname, "../../js/app.js"), "utf8").includes("cloud-tracker-mutation-repository"), false);
});
