(function tmdbSearchServiceModule(root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_TMDB_SEARCH = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const CONTRACT_VERSION = "1.0.0";
  const FUNCTION_NAME = "tmdb-search-tv";
  const MAX_CANDIDATES = 8;
  const OUTCOMES = Object.freeze({
    INVALID_REQUEST: "invalid_request",
    UNAUTHENTICATED: "unauthenticated",
    RATE_LIMITED: "rate_limited",
    NETWORK_UNAVAILABLE: "network_unavailable",
    UPSTREAM_UNAVAILABLE: "upstream_unavailable",
    CONFIGURATION_UNAVAILABLE: "configuration_unavailable",
    SEARCH_FAILED: "search_failed"
  });

  function failure(outcome, retryAfterSeconds = null) {
    return Object.freeze({ ok: false, outcome, candidates: Object.freeze([]), retryAfterSeconds });
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function requestFor(title, firstAirDate) {
    const query = typeof title === "string" ? title.trim() : "";
    const date = firstAirDate == null || firstAirDate === "" ? null : firstAirDate;
    if (!query || query.length > 300 || !(date === null || typeof date === "string") || (date !== null && !validDate(date))) return null;
    return { contractVersion: CONTRACT_VERSION, query, firstAirDate: date };
  }

  function normalizeCandidate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        !Number.isInteger(value.id) || value.id <= 0 || typeof value.name !== "string" || !value.name.trim() ||
        !(value.firstAirDate === null || (typeof value.firstAirDate === "string" && validDate(value.firstAirDate))) ||
        !(value.posterPath === null || (typeof value.posterPath === "string" && /^\/[A-Za-z0-9._/-]+$/.test(value.posterPath))) ||
        typeof value.overview !== "string") return null;
    return Object.freeze({
      id: value.id,
      name: value.name,
      firstAirDate: value.firstAirDate,
      posterPath: value.posterPath,
      overview: value.overview
    });
  }

  function normalizedRetry(value) {
    return Number.isInteger(value) && value >= 1 && value <= 3600 ? value : null;
  }

  function mappedOutcome(code) {
    if (code === "invalid_request") return OUTCOMES.INVALID_REQUEST;
    if (code === "unauthenticated") return OUTCOMES.UNAUTHENTICATED;
    if (code === "rate_limited") return OUTCOMES.RATE_LIMITED;
    if (code === "configuration_unavailable") return OUTCOMES.CONFIGURATION_UNAVAILABLE;
    if (code === "upstream_unavailable" || code === "response_invalid") return OUTCOMES.UPSTREAM_UNAVAILABLE;
    return OUTCOMES.SEARCH_FAILED;
  }

  function gatewayOutcome(error) {
    const status = Number(error && error.context && error.context.status);
    if (status === 401 || status === 403) return OUTCOMES.UNAUTHENTICATED;
    if (status === 429) return OUTCOMES.RATE_LIMITED;
    return OUTCOMES.SEARCH_FAILED;
  }

  async function responseBodyFromError(error) {
    const context = error && error.context;
    if (!context || typeof context.clone !== "function") return null;
    try { return await context.clone().json(); }
    catch { return null; }
  }

  function createTmdbSearchService({ bootstrap }) {
    if (!bootstrap || typeof bootstrap.getState !== "function" || typeof bootstrap.getClient !== "function") {
      throw new TypeError("Supabase bootstrap is required");
    }

    return Object.freeze({
      async search(title, firstAirDate = null) {
        const request = requestFor(title, firstAirDate);
        if (!request) return failure(OUTCOMES.INVALID_REQUEST);
        if (bootstrap.getState().status !== "ready") return failure(OUTCOMES.CONFIGURATION_UNAVAILABLE);
        const client = bootstrap.getClient();
        if (!client || !client.auth || !client.functions) return failure(OUTCOMES.CONFIGURATION_UNAVAILABLE);

        try {
          const sessionResult = await client.auth.getSession();
          if (sessionResult.error || !sessionResult.data || !sessionResult.data.session) return failure(OUTCOMES.UNAUTHENTICATED);
          const invocation = await client.functions.invoke(FUNCTION_NAME, { body: request });
          const body = invocation.error ? await responseBodyFromError(invocation.error) : invocation.data;
          if (invocation.error || !body || body.contractVersion !== CONTRACT_VERSION || body.outcome !== "success" ||
              !body.data || !Array.isArray(body.data.candidates)) {
            const code = body && body.error && body.error.code;
            const retry = normalizedRetry(body && body.error && body.error.retryAfterSeconds);
            return failure(code ? mappedOutcome(code) : gatewayOutcome(invocation.error), retry);
          }
          const candidates = body.data.candidates.slice(0, MAX_CANDIDATES).map(normalizeCandidate);
          if (candidates.some((candidate) => candidate === null)) return failure(OUTCOMES.UPSTREAM_UNAVAILABLE);
          return Object.freeze({
            ok: true,
            outcome: "success",
            candidates: Object.freeze(candidates),
            retryAfterSeconds: null
          });
        } catch (error) {
          return failure(error instanceof TypeError ? OUTCOMES.NETWORK_UNAVAILABLE : OUTCOMES.SEARCH_FAILED);
        }
      }
    });
  }

  return Object.freeze({ CONTRACT_VERSION, FUNCTION_NAME, MAX_CANDIDATES, OUTCOMES, createTmdbSearchService, requestFor });
});
