(function artworkEnrichmentApplicationModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_ARTWORK_APPLICATION = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const TMDB_ID = /^[1-9][0-9]*$/;
  const POSTER_PATH = /^\/\S+$/;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function blankArtwork(show) { return !show || typeof show.posterUrl !== "string" || show.posterUrl.trim() === ""; }
  function validProposal(value) {
    const tmdbId = Number(value && value.selectedTmdbId);
    return Boolean(value && typeof value.showId === "string" && value.showId &&
      TMDB_ID.test(String(value.selectedTmdbId)) && Number.isSafeInteger(tmdbId) && tmdbId > 0 &&
      typeof value.posterPath === "string" && POSTER_PATH.test(value.posterPath) &&
      value.posterUrl === `https://image.tmdb.org/t/p/w500${value.posterPath}` &&
      typeof value.selectedTmdbName === "string" &&
      (value.selectedFirstAirDate == null || /^\d{4}-\d{2}-\d{2}$/.test(value.selectedFirstAirDate)));
  }
  function artworkDraft(show, selected) {
    return {
      ...clone(show),
      posterUrl: selected.posterUrl,
      tmdb: {
        id: Number(selected.selectedTmdbId),
        name: selected.selectedTmdbName,
        firstAirDate: selected.selectedFirstAirDate || "",
        posterPath: selected.posterPath
      }
    };
  }
  function initialCounts(total) { return { total, applied: 0, skipped: 0, conflicted: 0, failed: 0, remaining: total }; }
  function snapshotResult(state, stoppedReason = null) {
    return Object.freeze({ ...state.counts, stoppedReason, running: state.running, cancelled: state.cancelled });
  }

  function createArtworkApplication({ getAuthority, readDevice, writeDevice, getCloudState, updateCloudShow, onProgress = () => {} } = {}) {
    if (typeof getAuthority !== "function" || typeof readDevice !== "function" || typeof writeDevice !== "function" ||
        typeof getCloudState !== "function" || typeof updateCloudShow !== "function" || typeof onProgress !== "function") {
      throw new TypeError("Artwork application dependencies are required");
    }
    const state = { running: false, cancelled: false, mode: null, queue: [], counts: initialCounts(0), stoppedReason: null };
    function publish(current = null) { const value = Object.freeze({ ...snapshotResult(state, state.stoppedReason), current }); onProgress(value); return value; }
    function cancel() { if (state.running) state.cancelled = true; }
    function setQueue(proposals) {
      state.queue = proposals.map(clone);
      state.counts = initialCounts(state.queue.length);
      state.cancelled = false;
      state.stoppedReason = null;
    }
    function finishItem(category) {
      state.counts[category] += 1;
      state.counts.remaining = state.queue.length;
    }

    async function applyDevice() {
      const read = await readDevice();
      if (!read || !read.ok || !read.data || !Array.isArray(read.data.shows)) {
        state.counts.failed = state.queue.length; state.queue = []; state.counts.remaining = 0; state.stoppedReason = "device_read_failed"; return publish();
      }
      const currentShows = clone(read.data.shows);
      const indexes = new Map(currentShows.map((show, index) => [String(show.id), index]));
      let changed = false;
      while (state.queue.length) {
        if (state.cancelled) { state.stoppedReason = "cancelled"; break; }
        const selected = state.queue.shift();
        const index = indexes.get(selected.showId);
        const current = index == null ? null : currentShows[index];
        publish(selected.showId);
        if (!validProposal(selected) || !current || !blankArtwork(current)) finishItem("skipped");
        else { currentShows[index] = artworkDraft(current, selected); changed = true; finishItem("applied"); }
        publish(selected.showId);
      }
      if (changed) {
        const write = await writeDevice(currentShows);
        if (!write || !write.ok) {
          state.counts.failed += state.counts.applied;
          state.counts.applied = 0;
          state.stoppedReason = "device_write_failed";
        }
      }
      return publish();
    }

    async function applyCloud() {
      while (state.queue.length) {
        if (state.cancelled) { state.stoppedReason = "cancelled"; break; }
        const cloud = getCloudState();
        if (!cloud || cloud.status !== "cloud_ready" || !cloud.snapshot || !Array.isArray(cloud.snapshot.shows)) {
          state.stoppedReason = cloud && cloud.status === "cloud_conflict" ? "conflict" : "cloud_stale_readonly";
          break;
        }
        const selected = state.queue.shift();
        const current = cloud.snapshot.shows.find((show) => String(show.id) === selected.showId) || null;
        publish(selected.showId);
        if (!validProposal(selected) || !current || !blankArtwork(current)) {
          finishItem("skipped"); publish(selected.showId); continue;
        }
        const result = await updateCloudShow(current, artworkDraft(current, selected));
        if (result && result.ok) finishItem("applied");
        else if (result && result.outcome === "conflict") { finishItem("conflicted"); state.stoppedReason = "conflict"; publish(selected.showId); break; }
        else {
          finishItem("failed");
          const after = getCloudState();
          if (!after || after.status !== "cloud_ready" || ["network_unavailable", "internal_error", "cloud_refresh_failed", "cloud_verification_failed"].includes(result && result.outcome)) {
            state.stoppedReason = "cloud_stale_readonly"; publish(selected.showId); break;
          }
        }
        publish(selected.showId);
      }
      return publish();
    }

    async function run() {
      if (state.running) return snapshotResult(state, "already_running");
      state.running = true; state.cancelled = false; state.stoppedReason = null; publish();
      try { return state.mode === "local" ? await applyDevice() : await applyCloud(); }
      finally { state.running = false; publish(); }
    }
    async function apply(proposals) {
      if (!Array.isArray(proposals) || proposals.length === 0 || state.running) return snapshotResult(state, proposals && proposals.length ? "already_running" : "nothing_selected");
      const authority = getAuthority();
      if (authority !== "local" && authority !== "cloud_ready") return snapshotResult(state, "authority_unavailable");
      state.mode = authority === "local" ? "local" : "cloud";
      setQueue(proposals);
      return run();
    }
    async function resume() {
      if (state.running || state.queue.length === 0 || (state.mode === "cloud" && getAuthority() !== "cloud_ready")) return snapshotResult(state, "resume_unavailable");
      return run();
    }
    function reset() {
      if (state.running) return false;
      state.mode = null; state.queue = []; state.counts = initialCounts(0); state.cancelled = false; state.stoppedReason = null;
      return true;
    }
    return Object.freeze({ apply, cancel, getState: () => Object.freeze({ ...snapshotResult(state, state.stoppedReason), mode: state.mode }), reset, resume });
  }

  return Object.freeze({ artworkDraft, blankArtwork, createArtworkApplication, validProposal });
});
