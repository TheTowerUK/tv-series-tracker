"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { countsFor, proposal, safeErrorMessage, selectedProposals } = require("../../js/artwork-enrichment-ui.js");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const show = { id: "show-1", title: "The Office", firstAirDate: "2005-03-24" };
const candidate = { id: 2316, name: "The Office", firstAirDate: "2005-03-24", posterPath: "/office.jpg", overview: "Workplace comedy" };

test("proposal model is temporary artwork metadata without revisions", () => {
  assert.deepEqual(proposal(show, candidate, "confident"), {
    showId: "show-1", trackerTitle: "The Office", selectedTmdbId: 2316,
    selectedTmdbName: "The Office", selectedFirstAirDate: "2005-03-24",
    posterPath: "/office.jpg", posterUrl: "https://image.tmdb.org/t/p/w500/office.jpg", source: "confident"
  });
  assert.equal("revision" in proposal(show, candidate, "confident"), false);
});

test("confident selections can be deselected and review candidates selected deterministically", () => {
  const results = [
    { show: { ...show, id: "b" }, classification: "confident", proposal: candidate },
    { show: { ...show, id: "a", title: "Ambiguous" }, classification: "needs_review", candidates: [{ ...candidate, id: 9 }] }
  ];
  const selections = new Map([
    ["b", { candidate, source: "confident" }],
    ["a", { candidate: { ...candidate, id: 9 }, source: "manual_review" }]
  ]);
  assert.deepEqual(selectedProposals(results, selections).map((item) => item.showId), ["a", "b"]);
  selections.delete("b");
  assert.deepEqual(selectedProposals(results, selections).map((item) => item.showId), ["a"]);
});

test("summary counts retain service failures as errors", () => {
  assert.deepEqual(countsFor([
    { classification: "confident" }, { classification: "needs_review" },
    { classification: "no_match" }, { classification: "error" }
  ]), { confidentProposals: 1, needsReview: 1, noMatch: 1, errors: 1 });
  assert.match(safeErrorMessage({ outcome: "rate_limited" }), /temporarily limited/i);
  assert.doesNotMatch(safeErrorMessage({ outcome: "rate_limited", diagnostics: "secret" }), /secret|diagnostic/i);
});

test("review UI is authenticated, user-started, cancellable and explicitly resumable", () => {
  const html = read("index.html");
  const source = read("js/artwork-enrichment-ui.js");
  assert.match(html, /<button[^>]*class="[^"]*hidden[^"]*"[^>]*id="findMissingArtworkBtn"/);
  assert.match(source, /state\.status === "authenticated"/);
  assert.match(source, /action\.addEventListener\("click", start\)/);
  assert.match(source, /AbortController/);
  assert.match(source, /resume\.addEventListener\("click", resume\)/);
  assert.match(source, /stopReason !== "rate_limited"/);
  assert.match(source, /Confident proposals/);
  assert.match(source, /Needs review/);
  assert.match(source, /No match/);
  assert.match(source, /Errors/);
});

test("review and discovery contain no persistence, RPC or apply path", () => {
  const source = `${read("js/artwork-enrichment.js")}\n${read("js/artwork-enrichment-ui.js")}`;
  assert.doesNotMatch(source, /localStorage|sessionStorage|writeTracker|\.rpc\s*\(|mutationRepository|cloudController|tracker_(?:create|update|delete|upsert)/);
  const html = read("index.html");
  assert.doesNotMatch(html, /id="applyArtwork|id="saveArtwork/i);
});

test("shared candidate view serves editor and review without sharing editor state", () => {
  const app = read("js/app.js");
  const review = read("js/artwork-enrichment-ui.js");
  assert.match(app, /TV_TRACKER_TMDB_CANDIDATE_VIEW\.candidateElement/);
  assert.match(review, /candidateView\.candidateElement/);
  assert.doesNotMatch(review, /pendingTmdbMatch/);
});
