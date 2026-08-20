(function trackerRepositoryModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_REPOSITORIES = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STORAGE_KEY = "tvSeriesTrackerData.v1";

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function success(data) {
    return Object.freeze({ ok: true, data: Object.freeze(data), error: null });
  }

  function failure(code) {
    return Object.freeze({ ok: false, data: null, error: Object.freeze({ code }) });
  }

  function createLocalTrackerRepository({ storage, storageKey = STORAGE_KEY } = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new TypeError("A Storage-compatible object is required");
    }

    return Object.freeze({
      kind: "local",
      capabilities: Object.freeze({ trackerRead: true, trackerWrite: true, receiptRead: false }),
      readTracker({ baseline }) {
        const baselineShows = deepCopy(Array.isArray(baseline) ? baseline : baseline && baseline.shows || []);
        try {
          const stored = JSON.parse(storage.getItem(storageKey) || "null");
          const shows = stored
            ? deepCopy(Array.isArray(stored) ? stored : stored.shows || [])
            : deepCopy(baselineShows);
          return success({ shows, source: stored ? "local_storage" : "packaged_baseline" });
        } catch {
          // Compatibility with the v1 runtime: malformed JSON currently falls back to the packaged baseline.
          return success({ shows: deepCopy(baselineShows), source: "packaged_baseline_invalid_storage" });
        }
      },
      writeTracker(shows) {
        if (!Array.isArray(shows)) return failure("invalid_tracker_data");
        try {
          storage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, shows }));
          return success({ count: shows.length });
        } catch {
          return failure("local_storage_write_failed");
        }
      }
    });
  }

  return Object.freeze({ STORAGE_KEY, createLocalTrackerRepository });
});
