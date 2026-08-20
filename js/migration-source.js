(function migrationSourceModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_MIGRATION_SOURCE = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STORAGE_KEY = "tvSeriesTrackerData.v1";
  const STATES = Object.freeze({
    MISSING: "missing_source",
    VALID_ENVELOPE: "valid_v1_envelope",
    VALID_BARE_ARRAY: "valid_legacy_bare_array",
    MALFORMED_JSON: "malformed_json",
    STRUCTURALLY_INVALID: "structurally_invalid",
    UNSUPPORTED_SCHEMA: "unsupported_schema"
  });
  const STATUS_MAP = Object.freeze({
    "Not Started": "not_started",
    Watching: "watching",
    Completed: "completed",
    "Purchase Only": "purchase_only",
    "Region Blocked": "region_blocked"
  });
  const SHOW_KEYS = new Set(["id", "platform", "title", "firstAirDate", "description", "posterUrl", "createdAt", "updatedAt", "seasons", "tmdb", "tmdbId", "tmdbPosterPath"]);
  const TMDB_KEYS = new Set(["id", "name", "firstAirDate", "posterPath"]);
  const RFC3339 = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  class SourceValidationError extends Error {
    constructor(path, code = "invalid_value") {
      super(code);
      this.name = "SourceValidationError";
      this.path = path;
      this.code = code;
    }
  }

  function exactDate(value, path, nullable = false) {
    if (nullable && (value === null || value === "" || value === undefined)) return null;
    if (typeof value !== "string" || !DATE.test(value)) throw new SourceValidationError(path);
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new SourceValidationError(path);
    }
    return value;
  }

  function exactInstant(value, path) {
    if (typeof value !== "string" || !RFC3339.test(value)) throw new SourceValidationError(path);
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new SourceValidationError(path);
    return instant;
  }

  function positiveTmdbId(value, path) {
    if (value === null || value === undefined) return null;
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new SourceValidationError(path);
    return value;
  }

  function nullablePosterPath(value, path) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > 255 || !value.startsWith("/")) throw new SourceValidationError(path);
    return value;
  }

  function normalizeV1Payload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join(",") !== "schemaVersion,shows" ||
        payload.schemaVersion !== 1 || !Array.isArray(payload.shows)) {
      throw new SourceValidationError("", "invalid_envelope");
    }

    const seenIds = new Set();
    const seenTmdbIds = new Set();
    const normalizedShows = payload.shows.map((show, showIndex) => {
      const base = `/shows/${showIndex}`;
      if (!show || typeof show !== "object" || Array.isArray(show)) throw new SourceValidationError(base, "object_required");
      const unknown = Object.keys(show).filter((key) => !SHOW_KEYS.has(key)).sort()[0];
      if (unknown) throw new SourceValidationError(`${base}/${unknown}`, "unknown_field");
      if (typeof show.id !== "string" || show.id.length < 1 || show.id.length > 100) throw new SourceValidationError(`${base}/id`);
      if (seenIds.has(show.id)) throw new SourceValidationError(`${base}/id`, "duplicate");
      seenIds.add(show.id);
      if (typeof show.platform !== "string" || show.platform.length < 1 || show.platform.length > 100 || show.platform.trim() !== show.platform) throw new SourceValidationError(`${base}/platform`);
      if (typeof show.title !== "string" || show.title.length < 1 || show.title.length > 300 || show.title.trim() !== show.title) throw new SourceValidationError(`${base}/title`);
      const firstAirDate = exactDate(show.firstAirDate, `${base}/firstAirDate`, true);
      const synopsis = show.description === undefined ? "" : show.description;
      if (typeof synopsis !== "string" || synopsis.length > 20000) throw new SourceValidationError(`${base}/description`);
      let posterUrl = show.posterUrl === undefined || show.posterUrl === "" ? null : show.posterUrl;
      if (posterUrl !== null && (typeof posterUrl !== "string" || posterUrl.length > 2048 || !/^https?:\/\//i.test(posterUrl))) throw new SourceValidationError(`${base}/posterUrl`);
      const created = exactInstant(show.createdAt, `${base}/createdAt`);
      const updated = exactInstant(show.updatedAt, `${base}/updatedAt`);
      if (updated < created) throw new SourceValidationError(`${base}/updatedAt`, "before_created_at");

      let nestedId = null;
      let nestedPath = null;
      if (show.tmdb !== undefined && show.tmdb !== null) {
        if (typeof show.tmdb !== "object" || Array.isArray(show.tmdb)) throw new SourceValidationError(`${base}/tmdb`, "object_required");
        const unknownTmdb = Object.keys(show.tmdb).filter((key) => !TMDB_KEYS.has(key)).sort()[0];
        if (unknownTmdb) throw new SourceValidationError(`${base}/tmdb/${unknownTmdb}`, "unknown_field");
        nestedId = positiveTmdbId(show.tmdb.id, `${base}/tmdb/id`);
        nestedPath = nullablePosterPath(show.tmdb.posterPath, `${base}/tmdb/posterPath`);
        if (show.tmdb.name !== undefined && show.tmdb.name !== null && typeof show.tmdb.name !== "string") throw new SourceValidationError(`${base}/tmdb/name`);
        if (show.tmdb.firstAirDate !== undefined && show.tmdb.firstAirDate !== null && show.tmdb.firstAirDate !== "") exactDate(show.tmdb.firstAirDate, `${base}/tmdb/firstAirDate`);
      }
      const aliasId = positiveTmdbId(show.tmdbId, `${base}/tmdbId`);
      const aliasPath = nullablePosterPath(show.tmdbPosterPath, `${base}/tmdbPosterPath`);
      if (nestedId !== null && aliasId !== null && nestedId !== aliasId) throw new SourceValidationError(`${base}/tmdbId`, "contradiction");
      if (nestedPath !== null && aliasPath !== null && nestedPath !== aliasPath) throw new SourceValidationError(`${base}/tmdbPosterPath`, "contradiction");
      const tmdbId = nestedId === null ? aliasId : nestedId;
      const tmdbPosterPath = nestedPath === null ? aliasPath : nestedPath;
      if (tmdbId !== null && seenTmdbIds.has(tmdbId)) throw new SourceValidationError(`${base}/tmdbId`, "duplicate");
      if (tmdbId !== null) seenTmdbIds.add(tmdbId);

      if (!Array.isArray(show.seasons)) throw new SourceValidationError(`${base}/seasons`, "array_required");
      const seenSeasons = new Set();
      const seasons = show.seasons.map((season, seasonIndex) => {
        const seasonPath = `${base}/seasons/${seasonIndex}`;
        if (!season || typeof season !== "object" || Array.isArray(season) ||
            Object.keys(season).sort().join(",") !== "number,status") throw new SourceValidationError(seasonPath, "invalid_structure");
        if (!Number.isInteger(season.number) || season.number < 1 || season.number > 32767) throw new SourceValidationError(`${seasonPath}/number`);
        if (seenSeasons.has(season.number)) throw new SourceValidationError(`${seasonPath}/number`, "duplicate");
        seenSeasons.add(season.number);
        const status = STATUS_MAP[season.status];
        if (!status) throw new SourceValidationError(`${seasonPath}/status`);
        return Object.freeze({ number: season.number, status });
      });

      return Object.freeze({
        identity: `legacy:${show.id}`, legacyId: show.id, platform: show.platform, title: show.title,
        firstAirDate, synopsis, posterUrl, tmdbId, tmdbPosterPath,
        createdAt: created.toISOString(), updatedAt: updated.toISOString(), seasons: Object.freeze(seasons)
      });
    });
    return Object.freeze({ schemaVersion: 2, shows: Object.freeze(normalizedShows) });
  }

  function result(state, { normalizedPayload = null, sourcePayload = null, sourceKind = null, errors = [] } = {}) {
    return Object.freeze({ ok: state === STATES.VALID_ENVELOPE || state === STATES.VALID_BARE_ARRAY, state, sourceKind, sourcePayload, normalizedPayload, errors: Object.freeze(errors) });
  }

  function validateParsedSource(parsed, sourceKind) {
    if (!Array.isArray(parsed) && parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion !== 1) {
      return result(STATES.UNSUPPORTED_SCHEMA, { sourceKind, sourcePayload: parsed, errors: [{ path: "/schemaVersion", code: "unsupported_version" }] });
    }
    const payload = Array.isArray(parsed) ? { schemaVersion: 1, shows: parsed } : parsed;
    try {
      return result(Array.isArray(parsed) ? STATES.VALID_BARE_ARRAY : STATES.VALID_ENVELOPE, {
        sourceKind, sourcePayload: payload, normalizedPayload: normalizeV1Payload(payload)
      });
    } catch (error) {
      const field = error instanceof SourceValidationError ? { path: error.path, code: error.code } : { path: "", code: "invalid_value" };
      return result(STATES.STRUCTURALLY_INVALID, { sourceKind, sourcePayload: payload, errors: [Object.freeze(field)] });
    }
  }

  function inspectMigrationSource({ storage, baseline, usePackagedBaselineWhenMissing = false, storageKey = STORAGE_KEY } = {}) {
    if (!storage || typeof storage.getItem !== "function") throw new TypeError("A Storage-compatible object is required");
    const raw = storage.getItem(storageKey);
    if (raw === null) {
      if (!usePackagedBaselineWhenMissing) return result(STATES.MISSING);
      const shows = Array.isArray(baseline) ? baseline : baseline && baseline.shows;
      const resolved = validateParsedSource({ schemaVersion: 1, shows }, "packaged_baseline");
      return Object.freeze({ ...resolved, state: STATES.MISSING, ok: resolved.ok, resolution: "packaged_baseline" });
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return result(STATES.MALFORMED_JSON, { sourceKind: "local_storage", errors: [{ path: "", code: "malformed_json" }] }); }
    return validateParsedSource(parsed, "local_storage");
  }

  return Object.freeze({ STATES, STATUS_MAP, STORAGE_KEY, SourceValidationError, inspectMigrationSource, normalizeV1Payload, validateParsedSource });
});
