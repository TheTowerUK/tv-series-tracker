(function artworkEnrichmentModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_ARTWORK_ENRICHMENT = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const CLASSIFICATIONS = Object.freeze({
    CONFIDENT: "confident",
    NEEDS_REVIEW: "needs_review",
    NO_MATCH: "no_match",
    ERROR: "error",
    ALREADY_HAS_ARTWORK: "already_has_artwork"
  });

  function hasArtwork(show) {
    return typeof (show && show.posterUrl) === "string" && show.posterUrl.trim().length > 0;
  }

  function normalizeTitle(value) {
    return String(value == null ? "" : value)
      .normalize("NFC")
      .toLocaleLowerCase("en-GB")
      .replace(/&/g, " and ")
      .replace(/[’‘`´']/g, "")
      .replace(/[‐‑‒–—―-]/g, " ")
      .replace(/[.,:;!?()[\]{}\"“”]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function yearOf(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 4) : null;
  }

  function usablePosterPath(value) {
    return typeof value === "string" && /^\/\S+$/.test(value.trim());
  }

  function showReference(show) {
    return Object.freeze({
      id: String(show && show.id == null ? "" : show.id),
      title: String(show && show.title == null ? "" : show.title),
      firstAirDate: typeof (show && show.firstAirDate) === "string" ? show.firstAirDate : null
    });
  }

  function safeCandidate(candidate) {
    return Object.freeze({
      id: candidate.id,
      name: String(candidate.name || ""),
      firstAirDate: typeof candidate.firstAirDate === "string" ? candidate.firstAirDate : null,
      posterPath: usablePosterPath(candidate.posterPath) ? candidate.posterPath.trim() : null,
      overview: typeof candidate.overview === "string" ? candidate.overview : ""
    });
  }

  function classifyCandidates(show, candidates) {
    const reference = showReference(show);
    if (hasArtwork(show)) {
      return Object.freeze({ show: reference, classification: CLASSIFICATIONS.ALREADY_HAS_ARTWORK, reason: "existing_artwork", proposal: null, candidates: Object.freeze([]), error: null });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return Object.freeze({ show: reference, classification: CLASSIFICATIONS.NO_MATCH, reason: "no_candidates", proposal: null, candidates: Object.freeze([]), error: null });
    }

    const normalized = candidates.filter((candidate) => candidate && typeof candidate === "object").map(safeCandidate);
    const usable = normalized.filter((candidate) => candidate.posterPath !== null);
    if (!usable.length) {
      return Object.freeze({ show: reference, classification: CLASSIFICATIONS.NO_MATCH, reason: "no_usable_artwork", proposal: null, candidates: Object.freeze([]), error: null });
    }

    const title = normalizeTitle(reference.title);
    const year = yearOf(reference.firstAirDate);
    const sameTitleYear = normalized.filter((candidate) => normalizeTitle(candidate.name) === title && year !== null && yearOf(candidate.firstAirDate) === year);
    const confident = sameTitleYear.filter((candidate) => candidate.posterPath !== null);
    if (confident.length === 1 && sameTitleYear.length === 1) {
      return Object.freeze({
        show: reference,
        classification: CLASSIFICATIONS.CONFIDENT,
        reason: "unique_title_year",
        proposal: confident[0],
        candidates: Object.freeze(usable),
        error: null
      });
    }

    const reason = year === null ? "tracker_year_unavailable"
      : sameTitleYear.length > 1 ? "ambiguous_title_year"
      : "title_or_year_requires_review";
    return Object.freeze({ show: reference, classification: CLASSIFICATIONS.NEEDS_REVIEW, reason, proposal: null, candidates: Object.freeze(usable), error: null });
  }

  function compareShows(left, right) {
    const leftId = String(left && left.id == null ? "" : left.id);
    const rightId = String(right && right.id == null ? "" : right.id);
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    const leftTitle = normalizeTitle(left && left.title);
    const rightTitle = normalizeTitle(right && right.title);
    return leftTitle < rightTitle ? -1 : leftTitle > rightTitle ? 1 : 0;
  }

  function resultCounts(results) {
    const count = (classification) => results.filter((result) => result.classification === classification).length;
    return Object.freeze({
      confidentProposals: count(CLASSIFICATIONS.CONFIDENT),
      needsReview: count(CLASSIFICATIONS.NEEDS_REVIEW),
      noMatch: count(CLASSIFICATIONS.NO_MATCH),
      errors: count(CLASSIFICATIONS.ERROR)
    });
  }

  function progressState(totalShows, alreadyHaveArtwork, eligible, results, cancelled, stopReason = null) {
    const counts = resultCounts(results);
    return Object.freeze({
      totalShows,
      alreadyHaveArtwork,
      eligible,
      processed: results.length,
      ...counts,
      cancelled,
      stopReason,
      unprocessed: eligible - results.length
    });
  }

  function serviceError(show, outcome, retryAfterSeconds = null) {
    return Object.freeze({
      show: showReference(show),
      classification: CLASSIFICATIONS.ERROR,
      reason: "service_error",
      proposal: null,
      candidates: Object.freeze([]),
      error: Object.freeze({ outcome: String(outcome || "search_failed"), retryAfterSeconds: Number.isInteger(retryAfterSeconds) ? retryAfterSeconds : null })
    });
  }

  function createArtworkDiscovery({ tmdbSearchService } = {}) {
    if (!tmdbSearchService || typeof tmdbSearchService.search !== "function") throw new TypeError("TMDB search service is required");

    return Object.freeze({
      async discover(shows, { signal = null, onProgress = () => {} } = {}) {
        if (!Array.isArray(shows) || typeof onProgress !== "function") throw new TypeError("Shows and progress callback are required");
        const ordered = [...shows].sort(compareShows);
        const eligibleShows = ordered.filter((show) => !hasArtwork(show));
        const totalShows = ordered.length;
        const alreadyHaveArtwork = totalShows - eligibleShows.length;
        const results = [];
        let cancelled = Boolean(signal && signal.aborted);
        let stopReason = cancelled ? "cancelled" : null;
        onProgress(progressState(totalShows, alreadyHaveArtwork, eligibleShows.length, results, cancelled, stopReason));

        for (const show of eligibleShows) {
          if (signal && signal.aborted) { cancelled = true; stopReason = "cancelled"; break; }
          let searchResult;
          try { searchResult = await tmdbSearchService.search(show.title, show.firstAirDate || null); }
          catch { searchResult = { ok: false, outcome: "search_failed", retryAfterSeconds: null }; }
          if (searchResult && searchResult.ok && Array.isArray(searchResult.candidates)) {
            results.push(classifyCandidates(show, searchResult.candidates));
          } else {
            results.push(serviceError(show, searchResult && searchResult.outcome, searchResult && searchResult.retryAfterSeconds));
            if (searchResult && searchResult.outcome === "rate_limited") stopReason = "rate_limited";
          }
          cancelled = Boolean(signal && signal.aborted);
          if (cancelled) stopReason = "cancelled";
          onProgress(progressState(totalShows, alreadyHaveArtwork, eligibleShows.length, results, cancelled, stopReason));
          if (cancelled || stopReason === "rate_limited") break;
        }

        const unprocessedShows = eligibleShows.slice(results.length).map(showReference);
        const counts = resultCounts(results);
        return Object.freeze({
          totalShows,
          alreadyHaveArtwork,
          eligible: eligibleShows.length,
          processed: results.length,
          ...counts,
          cancelled,
          stopReason,
          unprocessed: Object.freeze(unprocessedShows),
          results: Object.freeze(results)
        });
      }
    });
  }

  return Object.freeze({ CLASSIFICATIONS, classifyCandidates, createArtworkDiscovery, hasArtwork, normalizeTitle, usablePosterPath, yearOf });
});
