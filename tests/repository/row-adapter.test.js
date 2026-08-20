"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STATUS_TO_VIEW, adaptCloudTracker, revisionString } = require("../../js/tracker-row-adapter.js");

function showRow(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    legacy_id: "tv-1",
    platform: "TV",
    title: "Mapped Show",
    first_air_date: "2024-01-02",
    synopsis: "Tracker synopsis",
    poster_url: "https://images.example.test/custom.jpg",
    tmdb_id: 123,
    tmdb_poster_path: "/tmdb.jpg",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    revision: "9007199254740993",
    ...overrides
  };
}

function seasonRow(number, status, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    show_id: "00000000-0000-4000-8000-000000000001",
    season_number: number,
    status,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    revision: BigInt(number),
    ...overrides
  };
}

test("maps database fields into the existing browser model", () => {
  const [show] = adaptCloudTracker([showRow()], [seasonRow(2, "watching"), seasonRow(1, "not_started")]);
  assert.equal(show.description, "Tracker synopsis");
  assert.equal(show.firstAirDate, "2024-01-02");
  assert.equal(show.posterUrl, "https://images.example.test/custom.jpg");
  assert.deepEqual(show.tmdb, { id: 123, name: null, firstAirDate: null, posterPath: "/tmdb.jpg" });
  assert.equal(show.revision, "9007199254740993");
  assert.deepEqual(show.seasons.map(({ number, status, revision }) => ({ number, status, revision })), [
    { number: 1, status: "Not Started", revision: "1" },
    { number: 2, status: "Watching", revision: "2" }
  ]);
});

test("maps all five database statuses", () => {
  assert.deepEqual(STATUS_TO_VIEW, {
    not_started: "Not Started",
    watching: "Watching",
    completed: "Completed",
    purchase_only: "Purchase Only",
    region_blocked: "Region Blocked"
  });
});

test("poster URL remains independent from TMDB metadata", () => {
  const [withoutTmdb] = adaptCloudTracker([showRow({ tmdb_id: null, tmdb_poster_path: null })], []);
  assert.equal(withoutTmdb.posterUrl, "https://images.example.test/custom.jpg");
  assert.equal(withoutTmdb.tmdb, null);

  const [withoutPoster] = adaptCloudTracker([showRow({ poster_url: null })], []);
  assert.equal(withoutPoster.posterUrl, null);
  assert.equal(withoutPoster.tmdb.posterPath, "/tmdb.jpg");
});

test("revisions remain exact decimal strings", () => {
  assert.equal(revisionString("9223372036854775807"), "9223372036854775807");
  assert.equal(revisionString(12n), "12");
  assert.throws(() => revisionString(9007199254740992), /invalid_revision/);
});

test("shows and seasons are combined deterministically", () => {
  const second = showRow({ id: "00000000-0000-4000-8000-000000000002", legacy_id: "tv-2", title: "Second" });
  const rows = adaptCloudTracker([second, showRow()], [
    seasonRow(1, "completed", { show_id: second.id }),
    seasonRow(1, "watching")
  ]);
  assert.deepEqual(rows.map((show) => show.id), [showRow().id, second.id]);
  assert.deepEqual(rows.map((show) => show.seasons[0].status), ["Watching", "Completed"]);
});
