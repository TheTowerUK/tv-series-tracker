(function cloudTrackerSyncModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_CLOUD_SYNC = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATES = Object.freeze({
    INACTIVE: "inactive",
    CLOUD_READY: "cloud_ready",
    CLOUD_MUTATING: "cloud_mutating",
    CLOUD_REFRESHING: "cloud_refreshing",
    CLOUD_CONFLICT: "cloud_conflict",
    CLOUD_STALE_READONLY: "cloud_stale_readonly"
  });
  const OPERATIONS = Object.freeze(["createShow", "updateShow", "deleteShow", "createSeason", "updateSeason", "deleteSeason"]);

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }

  function clone(value) {
    return value == null ? value : deepFreeze(JSON.parse(JSON.stringify(value)));
  }

  function validSnapshot(snapshot) {
    return snapshot && typeof snapshot === "object" && Array.isArray(snapshot.shows) && snapshot.totals &&
      Number.isInteger(snapshot.totals.shows) && snapshot.totals.shows === snapshot.shows.length &&
      Number.isInteger(snapshot.totals.seasons) && snapshot.totals.seasons >= 0;
  }

  function seasonCount(shows) {
    return shows.reduce((total, show) => total + (Array.isArray(show.seasons) ? show.seasons.length : 0), 0);
  }

  function verifiedSnapshot(snapshot) {
    if (!validSnapshot(snapshot) || seasonCount(snapshot.shows) !== snapshot.totals.seasons) throw new TypeError("A verified cloud snapshot is required");
    return clone(snapshot);
  }

  function sameContext(left, right) {
    return Boolean(left && right && left.accountId && left.accountId === right.accountId && left.generation === right.generation);
  }

  function conflictRecord(submission, freshSnapshot) {
    const current = submission && submission.args && submission.args[0];
    return current && current.id ? freshSnapshot.shows.find((show) => show.id === current.id) || null : null;
  }

  function resolvedConflict(submission, result, supplied, freshSnapshot) {
    return clone({
      context: supplied,
      submission,
      result: { outcome: "conflict", conflict: result.conflict },
      currentRecord: conflictRecord(submission, freshSnapshot)
    });
  }

  function mutationRepresented(operation, data, snapshot) {
    const shows = snapshot.shows;
    const show = data && data.show;
    const season = data && data.season;
    const deleted = data && data.deleted;
    if (operation === "createShow") {
      const current = show && shows.find((item) => item.id === show.id);
      if (!current || current.revision !== show.revision) return false;
      return !Array.isArray(data.seasons) || data.seasons.every((created) =>
        current.seasons.some((item) => item.id === created.id && item.revision === created.revision));
    }
    if (operation === "updateShow") return Boolean(show && shows.some((item) => item.id === show.id && item.revision === show.revision));
    if (operation === "deleteShow") return Boolean(deleted && !shows.some((item) => item.id === deleted.id));
    if (operation === "createSeason" || operation === "updateSeason") {
      return Boolean(season && shows.some((item) => item.id === season.showId &&
        item.seasons.some((candidate) => candidate.id === season.id && candidate.revision === season.revision)));
    }
    if (operation === "deleteSeason") {
      return Boolean(deleted && shows.some((item) => item.id === deleted.showId &&
        !item.seasons.some((candidate) => candidate.id === deleted.id || candidate.number === deleted.number)));
    }
    return false;
  }

  function createCloudTrackerSync({ cloudRepository, mutationRepository, onStateChange = () => {} } = {}) {
    if (!cloudRepository || typeof cloudRepository.readTracker !== "function" || !mutationRepository) throw new TypeError("Cloud repositories are required");
    for (const operation of OPERATIONS) if (typeof mutationRepository[operation] !== "function") throw new TypeError("Complete mutation repository is required");

    let epoch = 0;
    let context = null;
    let snapshot = null;
    let conflict = null;
    let recovery = null;
    let state = Object.freeze({ status: STATES.INACTIVE, snapshot: null, conflict: null, recovery: null });

    function publish(status) {
      state = Object.freeze({ status, snapshot, conflict, recovery });
      onStateChange(state);
      return state;
    }

    function isCurrent(run, supplied) {
      return run === epoch && sameContext(context, supplied);
    }

    function activate({ accountId, generation, snapshot: suppliedSnapshot } = {}) {
      if (!accountId || generation == null) throw new TypeError("Verified account context is required");
      epoch += 1;
      context = Object.freeze({ accountId, generation });
      snapshot = verifiedSnapshot(suppliedSnapshot);
      conflict = null;
      recovery = null;
      return publish(STATES.CLOUD_READY);
    }

    function invalidate() {
      epoch += 1;
      context = null;
      snapshot = null;
      conflict = null;
      recovery = null;
      return publish(STATES.INACTIVE);
    }

    function reject(code) {
      return Object.freeze({ ok: false, outcome: code, data: null, conflict: null, error: Object.freeze({ code }) });
    }

    async function readFresh(run, supplied) {
      let result;
      try { result = await cloudRepository.readTracker(); }
      catch { return { ok: false, code: "cloud_refresh_failed" }; }
      if (!isCurrent(run, supplied)) return { ok: false, discarded: true };
      if (!result || !result.ok) return { ok: false, code: result && result.error && result.error.code || "cloud_refresh_failed" };
      try { return { ok: true, snapshot: verifiedSnapshot(result.data) }; }
      catch { return { ok: false, code: "cloud_verification_failed" }; }
    }

    async function mutate({ accountId, generation, operation, args = [], submitted = null } = {}) {
      const supplied = { accountId, generation };
      if (!sameContext(context, supplied)) return reject("authority_context_invalid");
      if (state.status !== STATES.CLOUD_READY) return reject("cloud_mutation_unavailable");
      if (!OPERATIONS.includes(operation) || !Array.isArray(args)) return reject("invalid_mutation");
      const run = epoch;
      const prior = snapshot;
      const submission = clone({ operation, args, submitted });
      recovery = null;
      publish(STATES.CLOUD_MUTATING);

      let result;
      try { result = await mutationRepository[operation](...args); }
      catch { result = reject("network_unavailable"); }
      if (!isCurrent(run, supplied)) return reject("operation_discarded");

      if (!result || result.outcome === "network_unavailable" || result.outcome === "internal_error") {
        snapshot = prior;
        recovery = clone({ kind: "uncertain_write", operation });
        publish(STATES.CLOUD_STALE_READONLY);
        return result && result.outcome ? result : reject("network_unavailable");
      }
      if (result.outcome === "unauthenticated" || result.outcome === "forbidden") {
        invalidate();
        return result;
      }
      if (result.outcome === "conflict") {
        conflict = clone({ context: supplied, submission, result: { outcome: "conflict", conflict: result.conflict }, currentRecord: null });
        publish(STATES.CLOUD_REFRESHING);
        const refreshed = await readFresh(run, supplied);
        if (refreshed.discarded) return reject("operation_discarded");
        if (!refreshed.ok) {
          snapshot = prior;
          recovery = clone({ kind: "conflict_refresh_failed", operation });
          publish(STATES.CLOUD_STALE_READONLY);
          return reject("cloud_refresh_failed");
        }
        snapshot = refreshed.snapshot;
        conflict = resolvedConflict(submission, result, supplied, snapshot);
        publish(STATES.CLOUD_CONFLICT);
        return Object.freeze({ ...result, snapshot });
      }
      if (!result.ok) {
        snapshot = prior;
        publish(STATES.CLOUD_READY);
        return result;
      }

      publish(STATES.CLOUD_REFRESHING);
      const refreshed = await readFresh(run, supplied);
      if (refreshed.discarded) return reject("operation_discarded");
      if (!refreshed.ok || !mutationRepresented(operation, result.data, refreshed.snapshot)) {
        snapshot = prior;
        recovery = clone({ kind: refreshed.ok ? "verification_mismatch" : "refresh_failed", operation });
        publish(STATES.CLOUD_STALE_READONLY);
        return reject(refreshed.ok ? "cloud_verification_failed" : "cloud_refresh_failed");
      }
      snapshot = refreshed.snapshot;
      conflict = null;
      recovery = null;
      publish(STATES.CLOUD_READY);
      return Object.freeze({ ...result, snapshot });
    }

    function clearConflict() {
      if (state.status !== STATES.CLOUD_CONFLICT) return false;
      conflict = null;
      recovery = null;
      publish(STATES.CLOUD_READY);
      return true;
    }

    async function recover({ accountId, generation } = {}) {
      const supplied = { accountId, generation };
      if (!sameContext(context, supplied) || state.status !== STATES.CLOUD_STALE_READONLY) return reject("recovery_unavailable");
      const run = epoch;
      const refreshed = await readFresh(run, supplied);
      if (refreshed.discarded) return reject("operation_discarded");
      if (!refreshed.ok) return reject("cloud_refresh_failed");
      snapshot = refreshed.snapshot;
      const resumeConflict = recovery && recovery.kind === "conflict_refresh_failed" && conflict;
      recovery = null;
      if (resumeConflict) {
        conflict = resolvedConflict(conflict.submission, conflict.result, supplied, snapshot);
        publish(STATES.CLOUD_CONFLICT);
      } else {
        conflict = null;
        publish(STATES.CLOUD_READY);
      }
      return Object.freeze({ ok: true, outcome: "success", data: { snapshot }, conflict: null, error: null });
    }

    return Object.freeze({ activate, clearConflict, getState: () => state, invalidate, mutate, recover });
  }

  return Object.freeze({ OPERATIONS, STATES, createCloudTrackerSync, mutationRepresented, verifiedSnapshot });
});
