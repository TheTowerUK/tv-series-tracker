(function trackerChecksumModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_CHECKSUM = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const encoder = new TextEncoder();

  function utcMilliseconds(value) {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new TypeError("Invalid canonical timestamp");
    return instant.toISOString();
  }

  function utf8Compare(left, right) {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function jsonString(value) {
    if (typeof value !== "string") throw new TypeError("Canonical string required");
    return JSON.stringify(value);
  }

  function nullableString(value) {
    return value === null ? "null" : jsonString(value);
  }

  function canonicalTrackerText(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1 ||
        !Array.isArray(payload.shows)) {
      throw new TypeError("Invalid canonical tracker payload");
    }

    const identities = new Set();
    const shows = [...payload.shows];
    for (const show of shows) {
      if (!show || typeof show !== "object" || Array.isArray(show) ||
          typeof show.identity !== "string" || show.identity.length === 0 ||
          !Array.isArray(show.seasons) || identities.has(show.identity)) {
        throw new TypeError("Invalid canonical tracker show");
      }
      identities.add(show.identity);
    }
    shows.sort((left, right) => utf8Compare(left.identity, right.identity));

    const showText = shows.map((show) => {
      const seasons = [...show.seasons].sort((left, right) => left.number - right.number);
      const seasonText = seasons.map((season) => {
        if (!Number.isInteger(season.number) || typeof season.status !== "string") {
          throw new TypeError("Invalid canonical season");
        }
        return `{"number":${season.number},"status":${jsonString(season.status)}}`;
      }).join(",");
      const tmdbId = show.tmdbId === null ? "null" : String(show.tmdbId);
      if (show.tmdbId !== null && !Number.isInteger(show.tmdbId)) throw new TypeError("Invalid canonical TMDB ID");
      return "{" +
        `"identity":${jsonString(show.identity)}` +
        `,"legacyId":${nullableString(show.legacyId)}` +
        `,"platform":${jsonString(show.platform)}` +
        `,"title":${jsonString(show.title)}` +
        `,"firstAirDate":${nullableString(show.firstAirDate)}` +
        `,"synopsis":${jsonString(show.synopsis)}` +
        `,"posterUrl":${nullableString(show.posterUrl)}` +
        `,"tmdbId":${tmdbId}` +
        `,"tmdbPosterPath":${nullableString(show.tmdbPosterPath)}` +
        `,"createdAt":${jsonString(utcMilliseconds(show.createdAt))}` +
        `,"updatedAt":${jsonString(utcMilliseconds(show.updatedAt))}` +
        `,"seasons":[${seasonText}]}`;
    }).join(",");

    return `{"schemaVersion":${payload.schemaVersion},"shows":[${showText}]}`;
  }

  async function sha256Hex(canonicalText, cryptoProvider = globalThis.crypto) {
    if (typeof canonicalText !== "string") throw new TypeError("Canonical text is required");
    if (!cryptoProvider || !cryptoProvider.subtle || typeof cryptoProvider.subtle.digest !== "function") {
      throw new Error("Web Crypto SHA-256 is unavailable");
    }
    const digest = await cryptoProvider.subtle.digest("SHA-256", encoder.encode(canonicalText));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function trackerChecksum(payload, cryptoProvider) {
    return sha256Hex(canonicalTrackerText(payload), cryptoProvider);
  }

  return Object.freeze({ canonicalTrackerText, sha256Hex, trackerChecksum, utf8Compare, utcMilliseconds });
});
