(function cloudTrackerExportModule(root, factory) {
  "use strict";
  const exported = factory(root && root.TV_TRACKER_CHECKSUM);
  if (typeof module === "object" && module.exports) module.exports = factory(require("./tracker-checksum.js"));
  if (root && root.document) root.TV_TRACKER_CLOUD_EXPORT = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule(checksumModule) {
  "use strict";

  const CONTRACT_VERSION = "2.0.0";
  const STATUS_TO_DATABASE = Object.freeze({
    "Not Started": "not_started", Watching: "watching", Completed: "completed",
    "Purchase Only": "purchase_only", "Region Blocked": "region_blocked"
  });
  const REVISION = /^[1-9][0-9]*$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function decimalRevision(value) {
    if (typeof value !== "string" || !REVISION.test(value)) throw new TypeError("Invalid verified cloud revision");
    return value;
  }

  function nullable(value) { return value == null || value === "" ? null : String(value); }

  function cloudIdentity(show) {
    if (show.legacyId != null && String(show.legacyId) !== "") return `legacy:${show.legacyId}`;
    const id = String(show.id || "").toLowerCase();
    if (!UUID.test(id)) throw new TypeError("Invalid cloud show identity");
    return `cloud:${id}`;
  }

  function logicalShow(show) {
    decimalRevision(show.revision);
    const tmdb = show.tmdb && typeof show.tmdb === "object" ? show.tmdb : null;
    const seasons = [...(show.seasons || [])].map((season) => {
      decimalRevision(season.revision);
      const status = STATUS_TO_DATABASE[season.status];
      if (!status) throw new TypeError("Invalid cloud season status");
      return { number: season.number, status };
    }).sort((left, right) => left.number - right.number);
    return {
      identity: cloudIdentity(show), legacyId: nullable(show.legacyId), platform: String(show.platform), title: String(show.title),
      firstAirDate: nullable(show.firstAirDate), synopsis: String(show.description == null ? "" : show.description),
      posterUrl: nullable(show.posterUrl), tmdbId: tmdb && tmdb.id != null ? tmdb.id : null,
      tmdbPosterPath: nullable(tmdb && tmdb.posterPath), createdAt: checksumModule.utcMilliseconds(show.createdAt),
      updatedAt: checksumModule.utcMilliseconds(show.updatedAt), seasons
    };
  }

  function buildCloudExportPayload(shows, { exportedAt = new Date().toISOString() } = {}) {
    if (!Array.isArray(shows)) throw new TypeError("A verified cloud snapshot is required");
    const orderedShows = shows.map(logicalShow).sort((left, right) => checksumModule.utf8Compare(left.identity, right.identity));
    const logical = { schemaVersion: 2, shows: orderedShows };
    checksumModule.canonicalTrackerText(logical);
    return Object.freeze({ schemaVersion: 2, contractVersion: CONTRACT_VERSION,
      exportedAt: checksumModule.utcMilliseconds(exportedAt), shows: Object.freeze(logical.shows) });
  }

  async function prepareCloudExport(shows, options = {}) {
    const payload = buildCloudExportPayload(shows, options);
    const checksum = await checksumModule.trackerChecksum({ schemaVersion: payload.schemaVersion, shows: payload.shows }, options.cryptoProvider);
    return Object.freeze({ payload, checksum });
  }

  function safeFilename(exportedAt) { return `tv-series-tracker-cloud-v2-${exportedAt.slice(0, 10)}.json`; }

  return Object.freeze({ CONTRACT_VERSION, STATUS_TO_DATABASE, buildCloudExportPayload, decimalRevision, prepareCloudExport, safeFilename });
});
