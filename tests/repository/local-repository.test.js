"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { STORAGE_KEY, createLocalTrackerRepository } = require("../../js/tracker-repository.js");

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
}

const baseline = [{ id: "tv-1", title: "Baseline", seasons: [{ number: 1, status: "Not Started" }] }];

test("uses the packaged baseline when tracker storage is missing", () => {
  const repository = createLocalTrackerRepository({ storage: storage() });
  const result = repository.readTracker({ baseline });
  assert.equal(result.ok, true);
  assert.equal(result.data.source, "packaged_baseline");
  assert.deepEqual(result.data.shows, baseline);
  assert.notEqual(result.data.shows, baseline);
});

test("preserves the current malformed-storage fallback behavior", () => {
  const repository = createLocalTrackerRepository({ storage: storage({ [STORAGE_KEY]: "{bad-json" }) });
  const result = repository.readTracker({ baseline });
  assert.equal(result.data.source, "packaged_baseline_invalid_storage");
  assert.deepEqual(result.data.shows, baseline);
});

test("accepts the current envelope and legacy bare-array forms", () => {
  const localShows = [{ id: "tv-2", title: "Local", seasons: [] }];
  for (const stored of [JSON.stringify(localShows), JSON.stringify({ schemaVersion: 1, shows: localShows })]) {
    const repository = createLocalTrackerRepository({ storage: storage({ [STORAGE_KEY]: stored }) });
    assert.deepEqual(repository.readTracker({ baseline }).data.shows, localShows);
  }
});

test("save writes the exact v1 envelope under the established key", () => {
  const localStorage = storage();
  const repository = createLocalTrackerRepository({ storage: localStorage });
  const shows = [{ id: "tv-3", title: "Saved", seasons: [] }];
  const result = repository.writeTracker(shows);
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.deepEqual(JSON.parse(localStorage.values.get(STORAGE_KEY)), { schemaVersion: 1, shows });
});

test("edit, import and reset compatibility use the same complete-snapshot write", () => {
  const localStorage = storage();
  const repository = createLocalTrackerRepository({ storage: localStorage });
  const edited = [{ id: "tv-1", title: "Edited", seasons: [{ number: 1, status: "Completed" }] }];
  const imported = [{ id: "tv-9", title: "Imported", seasons: [] }];
  repository.writeTracker(edited);
  assert.deepEqual(repository.readTracker({ baseline }).data.shows, edited);
  repository.writeTracker(imported);
  assert.deepEqual(repository.readTracker({ baseline }).data.shows, imported);
  repository.writeTracker(baseline);
  assert.deepEqual(repository.readTracker({ baseline: [] }).data.shows, baseline);
});

test("repository advertises local write capability and rejects invalid snapshots", () => {
  const repository = createLocalTrackerRepository({ storage: storage() });
  assert.deepEqual(repository.capabilities, { trackerRead: true, trackerWrite: true, receiptRead: false });
  assert.equal(repository.writeTracker({ shows: [] }).error.code, "invalid_tracker_data");
});
