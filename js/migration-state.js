(function migrationStateModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_MIGRATION_STATE = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATES = Object.freeze({ IDLE: "idle", LOADING: "loading", COMPLETED: "completed_migration", KEEP_DISMISSED: "keep_dismissed",
    REVIEW_REQUIRED: "review_required", SOURCE_ERROR: "source_error", CLOUD_ERROR: "cloud_error" });
  const CHOICES = Object.freeze(["keep_cloud", "replace_cloud", "reviewed_merge"]);

  function state(status, options = {}) {
    return Object.freeze({ status, accountId: options.accountId || null, source: options.source || null,
      receipt: options.receipt || null, sourceChecksum: options.sourceChecksum || null,
      cloudChecksum: options.cloudChecksum || null, cloudTotals: options.cloudTotals || null,
      cloudShows: options.cloudShows || null, reviewItems: options.reviewItems || null,
      choices: options.choices || Object.freeze([]), error: options.error || null });
  }

  function createMigrationStateService({ sourceInspector, checksum, cloudRepository, cloudPayload, diffBuilder, markerStore = null, storage, baseline, onStateChange = () => {} }) {
    if (![sourceInspector, checksum, cloudPayload, diffBuilder].every((value) => typeof value === "function") || !cloudRepository) throw new TypeError("Migration state dependencies are required");
    let current = state(STATES.IDLE);
    let generation = 0;
    let accountId = null;
    const listeners = new Set([onStateChange]);
    function publish(next) { current = next; for (const listener of listeners) listener(next); return next; }
    function invalidate(reason = "signed_out") { generation += 1; accountId = null; return publish(state(STATES.IDLE, { error: reason })); }

    async function inspect(nextAccountId) {
      generation += 1;
      const requestGeneration = generation;
      accountId = nextAccountId;
      publish(state(STATES.LOADING, { accountId }));
      const source = sourceInspector({ storage, baseline, usePackagedBaselineWhenMissing: true });
      let receiptResult;
      let cloudResult;
      try {
        receiptResult = await cloudRepository.readMigrationReceipt();
      } catch {
        if (requestGeneration !== generation) return current;
        return publish(state(STATES.CLOUD_ERROR, { accountId, source, error: { code: "cloud_read_failed" } }));
      }
      if (requestGeneration !== generation) return current;
      if (!receiptResult.ok) return publish(state(STATES.CLOUD_ERROR, { accountId, source, error: receiptResult.error }));
      try {
        cloudResult = await cloudRepository.readTracker();
      } catch {
        if (requestGeneration !== generation) return current;
        return publish(state(STATES.CLOUD_ERROR, { accountId, source, receipt: receiptResult.data.receipt, error: { code: "cloud_read_failed" } }));
      }
      if (requestGeneration !== generation) return current;
      if (!cloudResult.ok) return publish(state(STATES.CLOUD_ERROR, { accountId, source, receipt: receiptResult.data.receipt, error: cloudResult.error }));
      let canonicalCloud;
      let cloudChecksum;
      try {
        canonicalCloud = cloudPayload(cloudResult.data.shows);
        cloudChecksum = await checksum(canonicalCloud);
      } catch {
        return publish(state(STATES.CLOUD_ERROR, { accountId, source, receipt: receiptResult.data.receipt, error: { code: "invalid_cloud_snapshot" } }));
      }
      if (requestGeneration !== generation) return current;
      const common = { accountId, source, receipt: receiptResult.data.receipt, cloudChecksum,
        cloudTotals: cloudResult.data.totals, cloudShows: cloudResult.data.shows };
      if (receiptResult.data.receipt) return publish(state(STATES.COMPLETED, common));
      if (!source.ok || !source.normalizedPayload) return publish(state(STATES.SOURCE_ERROR, { ...common, error: { code: source.state } }));
      let sourceChecksum;
      let reviewItems;
      try {
        sourceChecksum = await checksum(source.normalizedPayload);
        reviewItems = diffBuilder(source.normalizedPayload, cloudResult.data.shows);
      } catch {
        return publish(state(STATES.SOURCE_ERROR, { ...common, error: { code: "source_processing_failed" } }));
      }
      if (requestGeneration !== generation) return current;
      let dismissed = false;
      try { dismissed = Boolean(markerStore && await markerStore.read(accountId, sourceChecksum)); } catch { dismissed = false; }
      if (dismissed) {
        if (requestGeneration !== generation) return current;
        return publish(state(STATES.KEEP_DISMISSED, { ...common, sourceChecksum }));
      }
      return publish(state(STATES.REVIEW_REQUIRED, { ...common, sourceChecksum, reviewItems, choices: CHOICES }));
    }

    async function applyAuthState(authState) {
      const nextId = authState && authState.status === "authenticated" ? authState.accountId : null;
      if (!nextId) return invalidate(authState && authState.status || "signed_out");
      if (nextId === accountId) return current;
      if (nextId !== accountId) { generation += 1; accountId = null; }
      return inspect(nextId);
    }
    function subscribe(listener) { listeners.add(listener); listener(current); return () => listeners.delete(listener); }
    return Object.freeze({ applyAuthState, getState: () => current, invalidate, inspect, subscribe });
  }

  return Object.freeze({ CHOICES, STATES, createMigrationStateService });
});
