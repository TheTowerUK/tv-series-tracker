(function migrationMarkerModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_MIGRATION_MARKER = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";
  const PREFIX = "tvSeriesTrackerMigrationDismissal.v1:";
  const MIGRATION_KEY = "localstorage-tvSeriesTrackerData.v1";

  function createKeepCloudMarkerStore({ storage, sha256Hex }) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") throw new TypeError("Storage is required");
    if (typeof sha256Hex !== "function") throw new TypeError("SHA-256 function is required");
    async function keyFor(accountId) {
      if (typeof accountId !== "string" || !accountId) throw new TypeError("Account identity is required");
      return PREFIX + await sha256Hex(accountId);
    }
    async function read(accountId, sourceChecksum) {
      const key = await keyFor(accountId);
      let marker;
      try { marker = JSON.parse(storage.getItem(key) || "null"); } catch { marker = null; }
      const valid = marker && marker.migrationKey === MIGRATION_KEY && marker.sourceChecksum === sourceChecksum;
      if (!valid && marker) storage.removeItem(key);
      return Boolean(valid);
    }
    async function write(accountId, sourceChecksum) {
      const key = await keyFor(accountId);
      // Device-only dismissal evidence. The derived key avoids storing the raw
      // Auth UUID; the value contains only migration identity and source hash.
      storage.setItem(key, JSON.stringify({ migrationKey: MIGRATION_KEY, sourceChecksum }));
    }
    async function clear(accountId) { storage.removeItem(await keyFor(accountId)); }
    return Object.freeze({ clear, read, write });
  }
  return Object.freeze({ MIGRATION_KEY, PREFIX, createKeepCloudMarkerStore });
});
