"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CLASSIFICATIONS,
  classifyCandidates,
  createArtworkDiscovery,
  hasArtwork,
  normalizeTitle
} = require("../../js/artwork-enrichment.js");

const show = (overrides = {}) => ({ id: "tv-1", title: "The Office", firstAirDate: "2005-03-24", posterUrl: "", ...overrides });
const candidate = (overrides = {}) => ({ id: 2316, name: "The Office", firstAirDate: "2005-03-24", posterPath: "/office.jpg", overview: "A workplace comedy.", ...overrides });
const success = (candidates) => ({ ok: true, outcome: "success", candidates, retryAfterSeconds: null });

test("blank and whitespace-only poster URLs require artwork", () => {
  assert.equal(hasArtwork(show({ posterUrl: "" })), false);
  assert.equal(hasArtwork(show({ posterUrl: "   " })), false);
  assert.equal(hasArtwork(show({ posterUrl: null })), false);
});

test("non-blank manual artwork is excluded", () => {
  assert.equal(hasArtwork(show({ posterUrl: " https://images.example/poster.jpg " })), true);
  const result = classifyCandidates(show({ posterUrl: "https://images.example/poster.jpg" }), [candidate()]);
  assert.equal(result.classification, CLASSIFICATIONS.ALREADY_HAS_ARTWORK);
  assert.equal(result.proposal, null);
});

test("title normalization is conservative, Unicode-preserving and punctuation-aware", () => {
  assert.equal(normalizeTitle("  Brooklyn—Nine–Nine  "), "brooklyn nine nine");
  assert.equal(normalizeTitle("Schitt’s Creek"), "schitts creek");
  assert.equal(normalizeTitle("Café Society"), "café society");
  assert.equal(normalizeTitle("Tom & Jerry"), normalizeTitle("Tom and Jerry"));
  assert.notEqual(normalizeTitle("Castevania"), normalizeTitle("Castlevania"));
});

test("one exact normalized title and year with artwork is confident", () => {
  const result = classifyCandidates(show(), [candidate(), candidate({ id: 99, name: "Office Girls", firstAirDate: "2011-01-01", posterPath: "/other.jpg" })]);
  assert.equal(result.classification, CLASSIFICATIONS.CONFIDENT);
  assert.equal(result.reason, "unique_title_year");
  assert.equal(result.proposal.id, 2316);
});

test("wrong year and fuzzy or partial titles need review", () => {
  assert.equal(classifyCandidates(show(), [candidate({ firstAirDate: "2001-07-09" })]).classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(classifyCandidates(show(), [candidate({ name: "The Office: Superfan Episodes" })]).classification, CLASSIFICATIONS.NEEDS_REVIEW);
});

test("duplicate matching title and year candidates are ambiguous even if one lacks a poster", () => {
  const result = classifyCandidates(show(), [candidate(), candidate({ id: 2, posterPath: null })]);
  assert.equal(result.classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(result.reason, "ambiguous_title_year");
});

test("no candidates or no usable poster is no match", () => {
  assert.equal(classifyCandidates(show(), []).classification, CLASSIFICATIONS.NO_MATCH);
  const withoutPoster = classifyCandidates(show(), [candidate({ posterPath: null })]);
  assert.equal(withoutPoster.classification, CLASSIFICATIONS.NO_MATCH);
  assert.equal(withoutPoster.reason, "no_usable_artwork");
});

test("discovery excludes existing artwork, searches sequentially and orders deterministically", async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const service = { async search(title, date) {
    calls.push([title, date]);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    active -= 1;
    return success([candidate({ id: title === "Alpha" ? 1 : 2, name: title, firstAirDate: date })]);
  } };
  const discovery = createArtworkDiscovery({ tmdbSearchService: service });
  const result = await discovery.discover([
    show({ id: "tv-2", title: "Zulu", firstAirDate: "2020-01-01" }),
    show({ id: "tv-0", title: "Existing", posterUrl: "https://images.example/existing.jpg" }),
    show({ id: "tv-1", title: "Alpha", firstAirDate: "2021-02-03" })
  ]);
  assert.deepEqual(calls, [["Alpha", "2021-02-03"], ["Zulu", "2020-01-01"]]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(result.results.map((item) => item.show.id), ["tv-1", "tv-2"]);
  assert.equal(result.totalShows, 3);
  assert.equal(result.alreadyHaveArtwork, 1);
  assert.equal(result.eligible, 2);
  assert.equal(result.confidentProposals, 2);
});

test("service errors remain errors rather than no-match results", async () => {
  const discovery = createArtworkDiscovery({ tmdbSearchService: { search: async () => ({ ok: false, outcome: "rate_limited", retryAfterSeconds: 60 }) } });
  const result = await discovery.discover([show()]);
  assert.equal(result.errors, 1);
  assert.equal(result.noMatch, 0);
  assert.deepEqual(result.results[0].error, { outcome: "rate_limited", retryAfterSeconds: 60 });
  assert.equal(result.stopReason, "rate_limited");
});

test("rate limiting stops new searches and preserves remaining work for a later resume", async () => {
  const calls = [];
  const discovery = createArtworkDiscovery({ tmdbSearchService: { async search(title) {
    calls.push(title);
    return { ok: false, outcome: "rate_limited", retryAfterSeconds: 30 };
  } } });
  const result = await discovery.discover([
    show({ id: "tv-1", title: "Alpha" }),
    show({ id: "tv-2", title: "Beta" })
  ]);
  assert.deepEqual(calls, ["Alpha"]);
  assert.equal(result.stopReason, "rate_limited");
  assert.deepEqual(result.unprocessed.map((item) => item.id), ["tv-2"]);
});

test("cancellation stops scheduling, retains completed work and reports unprocessed shows", async () => {
  const controller = new AbortController();
  const calls = [];
  const discovery = createArtworkDiscovery({ tmdbSearchService: { async search(title, date) {
    calls.push(title);
    controller.abort();
    return success([candidate({ name: title, firstAirDate: date })]);
  } } });
  const result = await discovery.discover([
    show({ id: "tv-1", title: "Alpha", firstAirDate: "2020-01-01" }),
    show({ id: "tv-2", title: "Beta", firstAirDate: "2021-01-01" })
  ], { signal: controller.signal });
  assert.deepEqual(calls, ["Alpha"]);
  assert.equal(result.cancelled, true);
  assert.equal(result.stopReason, "cancelled");
  assert.equal(result.processed, 1);
  assert.deepEqual(result.unprocessed.map((item) => item.id), ["tv-2"]);
});

test("progress distinguishes every discovery bucket", async () => {
  const progress = [];
  const responses = new Map([
    ["Confident", success([candidate({ name: "Confident", firstAirDate: "2020-01-01" })])],
    ["Review", success([candidate({ name: "Different", firstAirDate: "2020-01-01" })])],
    ["None", success([])],
    ["Error", { ok: false, outcome: "upstream_unavailable", candidates: [] }]
  ]);
  const discovery = createArtworkDiscovery({ tmdbSearchService: { search: async (title) => responses.get(title) } });
  const result = await discovery.discover([
    show({ id: "1", title: "Confident", firstAirDate: "2020-01-01" }),
    show({ id: "2", title: "Review", firstAirDate: "2020-01-01" }),
    show({ id: "3", title: "None", firstAirDate: "2020-01-01" }),
    show({ id: "4", title: "Error", firstAirDate: "2020-01-01" })
  ], { onProgress: (value) => progress.push(value) });
  assert.deepEqual({ confident: result.confidentProposals, review: result.needsReview, none: result.noMatch, errors: result.errors },
    { confident: 1, review: 1, none: 1, errors: 1 });
  assert.equal(progress.at(-1).processed, 4);
  assert.equal(progress.at(-1).unprocessed, 0);
});

test("discovery module has no tracker persistence or mutation path", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/artwork-enrichment.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|writeTracker|\.rpc\s*\(|tracker_update_show|tracker_create_show|tracker_delete_show|cloudController|mutationRepository/);
  assert.match(source, /tmdbSearchService\.search/);
});

test("browser loads discovery after TMDB search and before application startup", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  const search = html.indexOf('src="js/tmdb-search-service.js"');
  const discovery = html.indexOf('src="js/artwork-enrichment.js"');
  const app = html.indexOf('src="js/app.js"');
  assert.equal(search >= 0 && discovery > search && app > discovery, true);
  assert.doesNotMatch(html, /Find missing artwork/);
});
