"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { artworkDraft, createArtworkApplication, validProposal } = require("../../js/artwork-enrichment-application.js");

const proposal = (overrides = {}) => ({ showId: "show-1", trackerTitle: "Show", selectedTmdbId: 42,
  selectedTmdbName: "Show", selectedFirstAirDate: "2020-01-01", posterPath: "/show.jpg",
  posterUrl: "https://image.tmdb.org/t/p/w500/show.jpg", source: "confident", ...overrides });
const show = (overrides = {}) => ({ id: "show-1", platform: "TV", title: "Show", firstAirDate: "2020-01-01",
  description: "Keep me", posterUrl: "", tmdb: null, seasons: [{ number: 1, status: "Watching" }], revision: "9007199254740993", ...overrides });
const snapshot = (shows) => ({ shows, totals: { shows: shows.length, seasons: shows.reduce((n, item) => n + item.seasons.length, 0) } });

function harness(overrides = {}) {
  let authority = overrides.authority || "local";
  let device = overrides.device || [show()];
  let cloudState = overrides.cloudState || { status: "cloud_ready", snapshot: snapshot([show()]) };
  const writes = [], calls = [], progress = [];
  const application = createArtworkApplication({
    getAuthority: () => authority,
    readDevice: async () => ({ ok: true, data: { shows: structuredClone(device) } }),
    writeDevice: async (shows) => { writes.push(structuredClone(shows)); if (overrides.writeFailure) return { ok: false }; device = structuredClone(shows); return { ok: true }; },
    getCloudState: () => cloudState,
    updateCloudShow: async (current, draft) => {
      calls.push({ current: structuredClone(current), draft: structuredClone(draft) });
      if (overrides.cloudMutation) return overrides.cloudMutation({ current, draft, calls, setState: (next) => { cloudState = next; } });
      const updated = { ...draft, revision: String(BigInt(current.revision) + 1n) };
      cloudState = { status: "cloud_ready", snapshot: snapshot([updated]) };
      return { ok: true, outcome: "success", snapshot: cloudState.snapshot };
    },
    onProgress: (value) => progress.push(value)
  });
  return { application, calls, getCloudState: () => cloudState, progress, setAuthority: (value) => { authority = value; }, writes };
}

test("proposal validation and draft modify artwork only while preserving unrelated data", () => {
  assert.equal(validProposal(proposal()), true);
  assert.equal(validProposal(proposal({ posterPath: "bad" })), false);
  assert.equal(validProposal(proposal({ selectedTmdbId: "999999999999999999999" })), false);
  const current = show();
  const draft = artworkDraft(current, proposal());
  assert.equal(draft.posterUrl, proposal().posterUrl);
  assert.deepEqual(draft.tmdb, { id: 42, name: "Show", firstAirDate: "2020-01-01", posterPath: "/show.jpg" });
  assert.equal(draft.revision, "9007199254740993");
  assert.deepEqual(draft.seasons, current.seasons);
  assert.equal(draft.description, "Keep me");
});

test("device application rereads authoritatively and performs one complete-snapshot write", async () => {
  const h = harness({ device: [show(), show({ id: "show-2", title: "Second" })] });
  const result = await h.application.apply([proposal(), proposal({ showId: "show-2", selectedTmdbId: 43, posterPath: "/two.jpg", posterUrl: "https://image.tmdb.org/t/p/w500/two.jpg" })]);
  assert.deepEqual({ applied: result.applied, failed: result.failed, remaining: result.remaining }, { applied: 2, failed: 0, remaining: 0 });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0][0].description, "Keep me");
});

test("device application skips missing and newly-artworked shows and reports write failure", async () => {
  const h = harness({ device: [show({ posterUrl: "https://manual.example/poster.jpg" })], writeFailure: true });
  const skipped = await h.application.apply([proposal(), proposal({ showId: "missing" })]);
  assert.deepEqual({ applied: skipped.applied, skipped: skipped.skipped }, { applied: 0, skipped: 2 });
  assert.equal(h.writes.length, 0);
  const failed = harness({ writeFailure: true });
  const result = await failed.application.apply([proposal()]);
  assert.equal(result.applied, 0); assert.equal(result.failed, 1); assert.equal(result.stoppedReason, "device_write_failed");
});

test("cloud application is serialized, preserves decimal revision and requires each authoritative reread", async () => {
  const first = show(), second = show({ id: "show-2", title: "Second", revision: "9007199254740994" });
  let state = { status: "cloud_ready", snapshot: snapshot([first, second]) };
  let active = 0, maximum = 0;
  const calls = [];
  const app = createArtworkApplication({ getAuthority: () => "cloud_ready", readDevice: async () => null, writeDevice: async () => null,
    getCloudState: () => state, onProgress: () => {}, updateCloudShow: async (current, draft) => {
      active += 1; maximum = Math.max(maximum, active); calls.push(current.revision); await Promise.resolve(); active -= 1;
      const updated = { ...draft, revision: String(BigInt(current.revision) + 1n) };
      state = { status: "cloud_ready", snapshot: snapshot(state.snapshot.shows.map((item) => item.id === current.id ? updated : item)) };
      return { ok: true, outcome: "success", snapshot: state.snapshot };
    } });
  const result = await app.apply([proposal(), proposal({ showId: "show-2", selectedTmdbId: 43, posterPath: "/two.jpg", posterUrl: "https://image.tmdb.org/t/p/w500/two.jpg" })]);
  assert.equal(maximum, 1); assert.deepEqual(calls, ["9007199254740993", "9007199254740994"]); assert.equal(result.applied, 2);
});

test("cloud conflict stops later writes and resume never replays completed or conflicted items", async () => {
  let attempt = 0;
  const first = show(), second = show({ id: "show-2" }), third = show({ id: "show-3" });
  let state = { status: "cloud_ready", snapshot: snapshot([first, second, third]) };
  const calls = [];
  const app = createArtworkApplication({ getAuthority: () => state.status, readDevice: async () => null, writeDevice: async () => null,
    getCloudState: () => state, onProgress: () => {}, updateCloudShow: async (current, draft) => {
      calls.push(current.id); attempt += 1;
      if (attempt === 2) { state = { ...state, status: "cloud_conflict" }; return { ok: false, outcome: "conflict" }; }
      state = { status: "cloud_ready", snapshot: snapshot(state.snapshot.shows.map((item) => item.id === current.id ? { ...draft, revision: "2" } : item)) };
      return { ok: true, outcome: "success" };
    } });
  const proposals = ["show-1", "show-2", "show-3"].map((id, index) => proposal({ showId: id, selectedTmdbId: 40 + index, posterPath: `/${id}.jpg`, posterUrl: `https://image.tmdb.org/t/p/w500/${id}.jpg` }));
  const stopped = await app.apply(proposals);
  assert.deepEqual({ applied: stopped.applied, conflicted: stopped.conflicted, remaining: stopped.remaining }, { applied: 1, conflicted: 1, remaining: 1 });
  state = { ...state, status: "cloud_ready" };
  const resumed = await app.resume();
  assert.deepEqual(calls, ["show-1", "show-2", "show-3"]); assert.equal(resumed.applied, 2); assert.equal(resumed.remaining, 0);
});

test("stale or uncertain cloud result stops scheduling and is never replayed", async () => {
  let state = { status: "cloud_ready", snapshot: snapshot([show(), show({ id: "show-2" })]) };
  const calls = [];
  const app = createArtworkApplication({ getAuthority: () => state.status, readDevice: async () => null, writeDevice: async () => null,
    getCloudState: () => state, onProgress: () => {}, updateCloudShow: async (current) => {
      calls.push(current.id); state = { ...state, status: "cloud_stale_readonly" }; return { ok: false, outcome: "network_unavailable" };
    } });
  const result = await app.apply([proposal(), proposal({ showId: "show-2" })]);
  assert.deepEqual({ failed: result.failed, remaining: result.remaining, stoppedReason: result.stoppedReason }, { failed: 1, remaining: 1, stoppedReason: "cloud_stale_readonly" });
  state = { ...state, status: "cloud_ready" };
  await app.resume();
  assert.deepEqual(calls, ["show-1", "show-2"]);
});

test("safe TMDB uniqueness validation failure is counted without exposing or blocking later work", async () => {
  let state = { status: "cloud_ready", snapshot: snapshot([show(), show({ id: "show-2" })]) };
  const calls = [];
  const app = createArtworkApplication({ getAuthority: () => state.status, readDevice: async () => null, writeDevice: async () => null,
    getCloudState: () => state, onProgress: () => {}, updateCloudShow: async (current, draft) => {
      calls.push(current.id);
      if (current.id === "show-1") return { ok: false, outcome: "validation_error", error: { code: "duplicate_tmdb_id" } };
      state = { status: "cloud_ready", snapshot: snapshot(state.snapshot.shows.map((item) => item.id === current.id ? { ...draft, revision: "2" } : item)) };
      return { ok: true, outcome: "success" };
    } });
  const result = await app.apply([proposal(), proposal({ showId: "show-2", selectedTmdbId: 43, posterPath: "/two.jpg", posterUrl: "https://image.tmdb.org/t/p/w500/two.jpg" })]);
  assert.deepEqual(calls, ["show-1", "show-2"]);
  assert.deepEqual({ applied: result.applied, failed: result.failed, remaining: result.remaining }, { applied: 1, failed: 1, remaining: 0 });
  assert.doesNotMatch(JSON.stringify(result), /constraint|sqlstate|index/i);
});

test("cancellation stops between records and duplicate execution is rejected", async () => {
  let app;
  const calls = [];
  app = createArtworkApplication({ getAuthority: () => "cloud_ready", readDevice: async () => null, writeDevice: async () => null,
    getCloudState: () => ({ status: "cloud_ready", snapshot: snapshot([show(), show({ id: "show-2" })]) }), onProgress: () => {},
    updateCloudShow: async (current) => { calls.push(current.id); app.cancel(); return { ok: true, outcome: "success" }; } });
  const run = app.apply([proposal(), proposal({ showId: "show-2" })]);
  const duplicate = await app.apply([proposal()]);
  const result = await run;
  assert.equal(duplicate.stoppedReason, "already_running"); assert.deepEqual(calls, ["show-1"]); assert.equal(result.remaining, 1); assert.equal(result.stoppedReason, "cancelled");
});
