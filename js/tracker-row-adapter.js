(function trackerRowAdapterModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_ROW_ADAPTER = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATUS_TO_VIEW = Object.freeze({
    not_started: "Not Started",
    watching: "Watching",
    completed: "Completed",
    purchase_only: "Purchase Only",
    region_blocked: "Region Blocked"
  });

  class TrackerRowAdapterError extends Error {
    constructor(code) {
      super(code);
      this.name = "TrackerRowAdapterError";
      this.code = code;
    }
  }

  function revisionString(value) {
    if (typeof value === "bigint") return value.toString(10);
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
    throw new TrackerRowAdapterError("invalid_revision");
  }

  function mapSeasonRow(row) {
    const status = STATUS_TO_VIEW[row && row.status];
    if (!status) throw new TrackerRowAdapterError("invalid_season_status");
    return Object.freeze({
      id: row.id,
      showId: row.show_id,
      number: row.season_number,
      status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: revisionString(row.revision)
    });
  }

  function mapShowRow(row, seasons) {
    const hasTmdb = row.tmdb_id != null || row.tmdb_poster_path != null;
    return Object.freeze({
      id: row.id,
      legacyId: row.legacy_id,
      platform: row.platform,
      title: row.title,
      firstAirDate: row.first_air_date,
      description: row.synopsis,
      posterUrl: row.poster_url,
      tmdb: hasTmdb ? Object.freeze({
        id: row.tmdb_id,
        name: null,
        firstAirDate: null,
        posterPath: row.tmdb_poster_path
      }) : null,
      seasons: Object.freeze(seasons),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: revisionString(row.revision)
    });
  }

  function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function adaptCloudTracker(showRows, seasonRows) {
    if (!Array.isArray(showRows) || !Array.isArray(seasonRows)) {
      throw new TrackerRowAdapterError("invalid_cloud_rows");
    }

    const orderedShows = [...showRows].sort((left, right) => compareText(String(left.id), String(right.id)));
    const orderedSeasons = [...seasonRows].sort((left, right) =>
      compareText(String(left.show_id), String(right.show_id)) || left.season_number - right.season_number
    );
    const knownShows = new Set(orderedShows.map((row) => row.id));
    const seasonsByShow = new Map();

    for (const row of orderedSeasons) {
      if (!knownShows.has(row.show_id)) throw new TrackerRowAdapterError("orphan_season_row");
      const mapped = mapSeasonRow(row);
      const seasons = seasonsByShow.get(row.show_id) || [];
      seasons.push(mapped);
      seasonsByShow.set(row.show_id, seasons);
    }

    return Object.freeze(orderedShows.map((row) => mapShowRow(row, seasonsByShow.get(row.id) || [])));
  }

  return Object.freeze({ STATUS_TO_VIEW, TrackerRowAdapterError, adaptCloudTracker, revisionString });
});
