const CONTRACT_VERSION = "1.0.0";
const MAX_BODY_BYTES = 2048;
const MAX_CANDIDATES = 8;
const MAX_QUERY_LENGTH = 300;
const DEFAULT_TIMEOUT_MS = 5000;
const TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/tv";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json; charset=utf-8" });
const REQUEST_KEYS = new Set(["contractVersion", "query", "firstAirDate"]);

function errorBody(code, message, fields = [], retryAfterSeconds = null) {
  return {
    contractVersion: CONTRACT_VERSION,
    outcome: "error",
    data: null,
    error: { code, message, retryAfterSeconds, fields }
  };
}

function successBody(requestedYear, fallbackUsed, candidates) {
  return {
    contractVersion: CONTRACT_VERSION,
    outcome: "success",
    data: { requestedYear, fallbackUsed, candidates },
    error: null
  };
}

function response(body, status, corsHeaders = {}, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders, ...extraHeaders }
  });
}

function field(path, code, message) {
  return { path, code, message };
}

function strictDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fields: [field("", "object_required", "Request must be a JSON object.")] };
  }
  const unknown = Object.keys(value).filter((key) => !REQUEST_KEYS.has(key)).sort()[0];
  if (unknown) return { fields: [field(`/${unknown}`, "unknown_field", "Field is not permitted.")] };
  if (value.contractVersion !== CONTRACT_VERSION) {
    return { fields: [field("/contractVersion", "invalid_contract_version", `Contract version must be ${CONTRACT_VERSION}.`)] };
  }
  if (typeof value.query !== "string" || !value.query.trim() || value.query.trim().length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(value.query)) {
    return { fields: [field("/query", "invalid_query", `Query must be a non-blank string no longer than ${MAX_QUERY_LENGTH} characters.`)] };
  }
  if (value.firstAirDate !== undefined && value.firstAirDate !== null &&
      (typeof value.firstAirDate !== "string" || !strictDate(value.firstAirDate))) {
    return { fields: [field("/firstAirDate", "invalid_date", "First-air date must be null or a valid YYYY-MM-DD date.")] };
  }
  return {
    value: {
      query: value.query.trim(),
      firstAirDate: value.firstAirDate == null ? null : value.firstAirDate
    }
  };
}

function allowedOrigins(value) {
  return new Set(String(value || "").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function corsForRequest(request, origins) {
  const origin = request.headers.get("origin");
  if (!origin) return { allowed: true, headers: {} };
  if (!origins.has(origin)) return { allowed: false, headers: {} };
  return {
    allowed: true,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-max-age": "600",
      vary: "Origin"
    }
  };
}

function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  if (!Number.isFinite(seconds)) return null;
  return Math.min(3600, Math.max(1, seconds));
}

function normalizeCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isInteger(value.id) || value.id <= 0 ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 300 ||
      !(value.first_air_date == null || typeof value.first_air_date === "string") ||
      !["string", "object", "undefined"].includes(typeof value.poster_path) ||
      !(value.overview == null || typeof value.overview === "string")) {
    throw new Error("invalid_upstream_candidate");
  }
  const firstAirDate = value.first_air_date || null;
  const posterPath = value.poster_path == null || value.poster_path === "" ? null : value.poster_path;
  if (firstAirDate !== null && !strictDate(firstAirDate)) throw new Error("invalid_upstream_candidate");
  if (posterPath !== null && (typeof posterPath !== "string" || !posterPath.startsWith("/") || posterPath.length > 255)) {
    throw new Error("invalid_upstream_candidate");
  }
  const overview = value.overview || "";
  if (overview.length > 20000) throw new Error("invalid_upstream_candidate");
  return { id: value.id, name: value.name.trim(), firstAirDate, posterPath, overview };
}

async function readUpstream(upstreamResponse) {
  if (upstreamResponse.status === 429) {
    return { rateLimited: true, retryAfterSeconds: retryAfterSeconds(upstreamResponse.headers.get("retry-after")) };
  }
  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) return { configurationUnavailable: true };
  if (!upstreamResponse.ok) return { unavailable: true };
  let value;
  try { value = await upstreamResponse.json(); }
  catch { return { invalid: true }; }
  if (!value || typeof value !== "object" || !Array.isArray(value.results)) return { invalid: true };
  try { return { candidates: value.results.slice(0, MAX_CANDIDATES).map(normalizeCandidate), empty: value.results.length === 0 }; }
  catch { return { invalid: true }; }
}

function upstreamUrl(query, year) {
  const url = new URL(TMDB_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-GB");
  url.searchParams.set("page", "1");
  if (year !== null) url.searchParams.set("first_air_date_year", String(year));
  return url;
}

function upstreamError(result, corsHeaders) {
  if (result.rateLimited) {
    const seconds = result.retryAfterSeconds;
    return response(errorBody("rate_limited", "Artwork search is temporarily unavailable. Please try again later.", [], seconds), 429,
      corsHeaders, seconds ? { "retry-after": String(seconds) } : {});
  }
  if (result.configurationUnavailable) {
    return response(errorBody("configuration_unavailable", "Artwork search is not configured."), 503, corsHeaders);
  }
  if (result.invalid) return response(errorBody("response_invalid", "Artwork search returned an invalid response."), 502, corsHeaders);
  return response(errorBody("upstream_unavailable", "Artwork search is temporarily unavailable."), 502, corsHeaders);
}

function createHandler({ token, allowedOriginList, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const origins = allowedOrigins(allowedOriginList);
  return async function handle(request) {
    const cors = corsForRequest(request, origins);
    if (!cors.allowed) return response(errorBody("forbidden_origin", "This origin is not permitted."), 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors.headers });
    if (request.method !== "POST") return response(errorBody("method_not_allowed", "Only POST is supported."), 405, cors.headers, { allow: "POST, OPTIONS" });

    const authorization = request.headers.get("authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return response(errorBody("unauthenticated", "Authentication is required."), 401, cors.headers);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
      return response(errorBody("invalid_request", "Content type must be application/json.",
        [field("", "invalid_content_type", "Content type must be application/json.")]), 400, cors.headers);
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return response(errorBody("invalid_request", "Request body is too large.", [field("", "body_too_large", "Request body is too large.")]), 400, cors.headers);
    }
    let text;
    try { text = await request.text(); }
    catch { return response(errorBody("invalid_request", "Request body could not be read."), 400, cors.headers); }
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return response(errorBody("invalid_request", "Request body is too large.", [field("", "body_too_large", "Request body is too large.")]), 400, cors.headers);
    }
    let body;
    try { body = JSON.parse(text); }
    catch { return response(errorBody("invalid_request", "Request must contain valid JSON.", [field("", "invalid_json", "Request must contain valid JSON.")]), 400, cors.headers); }
    const validation = validateRequest(body);
    if (!validation.value) return response(errorBody("invalid_request", "One or more fields are invalid.", validation.fields), 400, cors.headers);
    if (!token) return response(errorBody("configuration_unavailable", "Artwork search is not configured."), 503, cors.headers);

    const requestedYear = validation.value.firstAirDate === null ? null : Number(validation.value.firstAirDate.slice(0, 4));
    let fallbackUsed = false;
    let requestCount = 0;
    async function search(year) {
      requestCount += 1;
      if (requestCount > 2) throw new Error("request_limit_exceeded");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const upstreamResponse = await fetchImpl(upstreamUrl(validation.value.query, year), {
          method: "GET",
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
          signal: controller.signal
        });
        return await readUpstream(upstreamResponse);
      } finally { clearTimeout(timer); }
    }

    try {
      let result = await search(requestedYear);
      if (result.candidates && result.empty && requestedYear !== null) {
        fallbackUsed = true;
        result = await search(null);
      }
      if (!result.candidates) return upstreamError(result, cors.headers);
      return response(successBody(requestedYear, fallbackUsed, result.candidates), 200, cors.headers);
    } catch (error) {
      if (error && error.name === "AbortError") {
        return response(errorBody("upstream_unavailable", "Artwork search timed out."), 504, cors.headers);
      }
      return response(errorBody("internal_error", "Artwork search could not be completed."), 500, cors.headers);
    }
  };
}

export {
  CONTRACT_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_CANDIDATES,
  TMDB_SEARCH_URL,
  createHandler,
  retryAfterSeconds,
  validateRequest
};
