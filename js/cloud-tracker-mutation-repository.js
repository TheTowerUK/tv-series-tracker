(function cloudTrackerMutationRepositoryModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_CLOUD_MUTATION_REPOSITORY = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const CONTRACT_VERSION = "2.0.0";
  const ENVELOPE_KEYS = Object.freeze(["conflict", "contractVersion", "data", "entity", "entityId", "error", "operation", "outcome"]);
  const RPC = Object.freeze({
    createShow: "tracker_create_show",
    updateShow: "tracker_update_show",
    deleteShow: "tracker_delete_show",
    upsertSeason: "tracker_upsert_season",
    deleteSeason: "tracker_delete_season"
  });
  const STATUS_TO_DATABASE = Object.freeze({
    "Not Started": "not_started",
    Watching: "watching",
    Completed: "completed",
    "Purchase Only": "purchase_only",
    "Region Blocked": "region_blocked"
  });
  const REVISION_PATTERN = /^[1-9][0-9]*$/;
  const MAX_REVISION = 9223372036854775807n;

  function revisionString(value) {
    if (typeof value !== "string" || !REVISION_PATTERN.test(value) || BigInt(value) > MAX_REVISION) {
      throw new TypeError("revision must be a positive decimal string");
    }
    return value;
  }

  function nullableText(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text || null;
  }

  function databaseStatus(value) {
    const status = STATUS_TO_DATABASE[value];
    if (!status) throw new TypeError("Unsupported season status");
    return status;
  }

  function tmdbValues(show) {
    const tmdb = show && show.tmdb && typeof show.tmdb === "object" ? show.tmdb : null;
    return { tmdbId: tmdb && tmdb.id != null ? tmdb.id : null, tmdbPosterPath: nullableText(tmdb && tmdb.posterPath) };
  }

  function showFields(show) {
    if (!show || typeof show !== "object") throw new TypeError("A show is required");
    const tmdb = tmdbValues(show);
    return {
      platform: String(show.platform == null ? "" : show.platform).trim(),
      title: String(show.title == null ? "" : show.title).trim(),
      firstAirDate: nullableText(show.firstAirDate),
      synopsis: String(show.description == null ? "" : show.description),
      posterUrl: nullableText(show.posterUrl),
      tmdbId: tmdb.tmdbId,
      tmdbPosterPath: tmdb.tmdbPosterPath
    };
  }

  function buildCreateShowRequest(show) {
    const request = showFields(show);
    if (!request.platform || !request.title) throw new TypeError("platform and title are required");
    if (show.seasons !== undefined) {
      if (!Array.isArray(show.seasons)) throw new TypeError("seasons must be an array");
      request.seasons = show.seasons.map((season) => ({
        number: season.number,
        status: databaseStatus(season.status)
      }));
    }
    return request;
  }

  function buildShowPatch(current, draft) {
    const before = showFields(current);
    const after = showFields(draft);
    const patch = {};
    for (const key of Object.keys(after)) if (after[key] !== before[key]) patch[key] = after[key];
    return Object.keys(patch).length ? patch : null;
  }

  function buildUpdateShowRequest(current, draft) {
    if (!current || !current.id) throw new TypeError("A current cloud show is required");
    const showPatch = buildShowPatch(current, draft);
    if (!showPatch) return null;
    return { showId: current.id, expectedRevision: revisionString(current.revision), showPatch };
  }

  function buildDeleteShowRequest(show) {
    if (!show || !show.id) throw new TypeError("A current cloud show is required");
    return { showId: show.id, expectedRevision: revisionString(show.revision) };
  }

  function buildUpsertSeasonRequest(show, season, { create = false } = {}) {
    if (!show || !show.id || !season) throw new TypeError("A cloud show and season are required");
    return {
      showId: show.id,
      seasonNumber: season.number,
      expectedRevision: create ? null : revisionString(season.revision),
      status: databaseStatus(season.status)
    };
  }

  function buildDeleteSeasonRequest(show, season) {
    if (!show || !show.id || !season) throw new TypeError("A cloud show and season are required");
    return { showId: show.id, seasonNumber: season.number, expectedRevision: revisionString(season.revision) };
  }

  function safeFailure(outcome, code = outcome) {
    return Object.freeze({ ok: false, outcome, data: null, conflict: null, error: Object.freeze({ code }) });
  }

  function transportFailure(error) {
    const status = Number(error && error.status);
    const message = String(error && error.message || "").toLowerCase();
    if (status === 401 || /jwt.*(expired|missing)|not authenticated/.test(message)) return safeFailure("unauthenticated");
    if (status === 403 || /permission denied|forbidden/.test(message)) return safeFailure("forbidden");
    if (status === 0 || error instanceof TypeError || /fetch|network|offline|connection/.test(message)) return safeFailure("network_unavailable");
    return safeFailure("internal_error");
  }

  function hasExactEnvelope(value) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === ENVELOPE_KEYS.join(",") && value.contractVersion === CONTRACT_VERSION;
  }

  function revisionsAreStrings(value, operation) {
    const revisions = [];
    if (value && value.conflict) {
      if (value.conflict.expectedRevision != null) revisions.push(value.conflict.expectedRevision);
      if (value.conflict.currentRevision != null) revisions.push(value.conflict.currentRevision);
      if (value.conflict.currentRecord && value.conflict.currentRecord.revision != null) revisions.push(value.conflict.currentRecord.revision);
    }
    const data = value && value.data;
    if (data && data.show && data.show.revision != null) revisions.push(data.show.revision);
    if (data && Array.isArray(data.seasons)) for (const season of data.seasons) revisions.push(season.revision);
    if (data && data.season && data.season.revision != null) revisions.push(data.season.revision);
    if (data && data.deleted && data.deleted.revision != null) revisions.push(data.deleted.revision);
    return revisions.every((revision) => typeof revision === "string" && REVISION_PATTERN.test(revision)) &&
      !(operation === RPC.createShow && data && data.show && typeof data.show.revision !== "string");
  }

  function normalizeRpcResult(result, operation) {
    if (!result || result.error) return transportFailure(result && result.error);
    const value = result.data;
    if (!hasExactEnvelope(value) || value.operation !== operation || !revisionsAreStrings(value, operation)) return safeFailure("internal_error");
    if (value.outcome === "success") return Object.freeze({ ok: true, outcome: "success", data: value.data, conflict: null, error: null });
    if (value.outcome === "conflict") {
      const source = value.conflict && typeof value.conflict === "object" ? value.conflict : {};
      const conflict = { kind: String(source.kind || "revision") };
      if (source.expectedRevision === null) conflict.expectedRevision = null;
      else if (typeof source.expectedRevision === "string" && REVISION_PATTERN.test(source.expectedRevision)) conflict.expectedRevision = source.expectedRevision;
      if (typeof source.currentRevision === "string" && REVISION_PATTERN.test(source.currentRevision)) conflict.currentRevision = source.currentRevision;
      if (source.currentRecord && typeof source.currentRecord === "object" && !Array.isArray(source.currentRecord)) conflict.currentRecord = source.currentRecord;
      return Object.freeze({ ok: false, outcome: "conflict", data: null, conflict: Object.freeze(conflict), error: null });
    }
    if (value.error && value.error.code === "auth_context_missing") return safeFailure("unauthenticated");
    if (["validation_error", "not_found", "internal_error"].includes(value.outcome)) {
      const code = value.outcome === "internal_error" ? "internal_error" : String(value.error && value.error.code || value.outcome);
      return safeFailure(value.outcome, code);
    }
    return safeFailure("internal_error");
  }

  function createCloudTrackerMutationRepository({ client } = {}) {
    if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client is required");
    async function invoke(operation, request) {
      try { return normalizeRpcResult(await client.rpc(operation, { request }), operation); }
      catch (error) { return transportFailure(error); }
    }
    return Object.freeze({
      kind: "cloud-mutations",
      capabilities: Object.freeze({ trackerWrite: true, automaticRetry: false, postWriteRefresh: false }),
      createShow: (show) => invoke(RPC.createShow, buildCreateShowRequest(show)),
      updateShow(current, draft) {
        const request = buildUpdateShowRequest(current, draft);
        return request ? invoke(RPC.updateShow, request) : Promise.resolve(Object.freeze({ ok: true, outcome: "success", noOp: true, data: null, conflict: null, error: null }));
      },
      deleteShow: (show) => invoke(RPC.deleteShow, buildDeleteShowRequest(show)),
      createSeason: (show, season) => invoke(RPC.upsertSeason, buildUpsertSeasonRequest(show, season, { create: true })),
      updateSeason: (show, season) => invoke(RPC.upsertSeason, buildUpsertSeasonRequest(show, season)),
      deleteSeason: (show, season) => invoke(RPC.deleteSeason, buildDeleteSeasonRequest(show, season))
    });
  }

  return Object.freeze({
    CONTRACT_VERSION, ENVELOPE_KEYS, RPC, STATUS_TO_DATABASE,
    buildCreateShowRequest, buildDeleteSeasonRequest, buildDeleteShowRequest, buildShowPatch,
    buildUpdateShowRequest, buildUpsertSeasonRequest, createCloudTrackerMutationRepository,
    normalizeRpcResult, revisionString, transportFailure
  });
});
