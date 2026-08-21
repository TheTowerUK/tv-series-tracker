(function migrationExecutionModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_MIGRATION_EXECUTION = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";
  const MIGRATION_KEY = "localstorage-tvSeriesTrackerData.v1";
  const MODES = Object.freeze(["keep_cloud", "replace_cloud", "reviewed_merge"]);
  const ENVELOPE_KEYS = Object.freeze(["conflict", "contractVersion", "data", "entity", "entityId", "error", "operation", "outcome"]);
  const STATES = Object.freeze({ IDLE: "idle", EXECUTING: "executing", CONFLICT: "conflict", FAILURE: "failure", CLOUD_READ_ONLY: "cloud_read_only" });

  function buildMigrationRequest(prepared, mode, mergeDecisions = { decisions: [] }) {
    if (!prepared || prepared.status !== "review_required" || !prepared.source || !prepared.source.ok || !prepared.source.sourcePayload) throw new TypeError("Validated review state is required");
    if (!MODES.includes(mode)) throw new TypeError("Unsupported migration mode");
    if (!/^[0-9a-f]{64}$/.test(prepared.sourceChecksum || "") || !/^[0-9a-f]{64}$/.test(prepared.cloudChecksum || "")) throw new TypeError("Prepared checksums are required");
    if (!mergeDecisions || !Array.isArray(mergeDecisions.decisions)) throw new TypeError("Prepared merge decisions are required");
    if (mode !== "reviewed_merge" && mergeDecisions.decisions.length) throw new TypeError("Decisions are allowed only for reviewed merge");
    return Object.freeze({ migrationKey: MIGRATION_KEY, mode, sourceSchemaVersion: 1,
      sourcePayload: prepared.source.sourcePayload, sourceChecksum: prepared.sourceChecksum,
      expectedCloudChecksum: prepared.cloudChecksum, mergeDecisions });
  }

  function transportFailure(error) {
    const status = Number(error && error.status);
    const message = String(error && error.message || "").toLowerCase();
    let code = "internal_error";
    if (status === 401) code = "unauthenticated";
    else if (status === 403) code = "forbidden";
    else if (status === 0 || error instanceof TypeError || /fetch|network|offline/.test(message)) code = "network_unavailable";
    return Object.freeze({ ok: false, outcome: code, data: null, conflict: null, error: Object.freeze({ code }) });
  }

  function normalizeRpcResult(result) {
    if (!result || result.error) return transportFailure(result && result.error);
    const value = result.data;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== ENVELOPE_KEYS.join(",") ||
        value.contractVersion !== "2.0.0" || value.operation !== "tracker_migrate_v1") return transportFailure(null);
    if (value.outcome === "success") return Object.freeze({ ok: true, outcome: "success", data: value.data, conflict: null, error: null });
    if (value.outcome === "conflict") return Object.freeze({ ok: false, outcome: "conflict", data: null, conflict: value.conflict ? Object.freeze({ kind: value.conflict.kind || "cloud_state" }) : Object.freeze({ kind: "cloud_state" }), error: null });
    if (value.error && value.error.code === "auth_context_missing") return Object.freeze({ ok: false, outcome: "unauthenticated", data: null, conflict: null, error: Object.freeze({ code: "unauthenticated" }) });
    if (value.outcome === "validation_error") return Object.freeze({ ok: false, outcome: "validation_error", data: null, conflict: null, error: Object.freeze({ code: value.error && value.error.code || "validation_error" }) });
    return Object.freeze({ ok: false, outcome: "internal_error", data: null, conflict: null, error: Object.freeze({ code: "internal_error" }) });
  }

  function createMigrationExecutionService({ client, cloudRepository, cloudPayload, checksum, markerStore, onStateChange = () => {}, onConflict = async () => {} }) {
    if (!client || typeof client.rpc !== "function" || !cloudRepository || typeof cloudPayload !== "function" || typeof checksum !== "function") throw new TypeError("Execution dependencies are required");
    let current = Object.freeze({ status: STATES.IDLE, accountId: null, cloudShows: null, error: null });
    let generation = 0;
    function publish(status, options = {}) { current = Object.freeze({ status, accountId: options.accountId || null, cloudShows: options.cloudShows || null, error: options.error || null }); onStateChange(current); return current; }
    function clear() { generation += 1; return publish(STATES.IDLE); }

    async function verify({ mode, prepared, rpcData }) {
      if (!rpcData || rpcData.mode !== mode || rpcData.sourceChecksum !== prepared.sourceChecksum ||
          !/^[0-9a-f]{64}$/.test(rpcData.resultChecksum || "")) return { ok: false, code: "verification_failed" };
      const tracker = await cloudRepository.readTracker();
      if (!tracker.ok) return { ok: false, code: "verification_failed" };
      const verifiedChecksum = await checksum(cloudPayload(tracker.data.shows));
      const totals = rpcData && rpcData.finalTotals;
      if (verifiedChecksum !== rpcData.resultChecksum || !totals || totals.shows !== tracker.data.totals.shows || totals.seasons !== tracker.data.totals.seasons) return { ok: false, code: "verification_failed" };
      const receiptResult = await cloudRepository.readMigrationReceipt();
      if (!receiptResult.ok) return { ok: false, code: "verification_failed" };
      const receipt = receiptResult.data.receipt;
      if (mode === "keep_cloud") {
        if (rpcData.receipt !== null || receipt !== null) return { ok: false, code: "verification_failed" };
      } else {
        if (!receipt || receipt.migrationKey !== MIGRATION_KEY || receipt.sourceChecksum !== prepared.sourceChecksum ||
            receipt.resultChecksum !== rpcData.resultChecksum || rpcData.sourceChecksum !== prepared.sourceChecksum) return { ok: false, code: "verification_failed" };
        if (mode === "replace_cloud" && (rpcData.resultChecksum !== prepared.sourceChecksum || receipt.resultChecksum !== receipt.sourceChecksum)) return { ok: false, code: "verification_failed" };
      }
      return { ok: true, cloudShows: tracker.data.shows };
    }

    async function execute({ accountId, prepared, mode, mergeDecisions = { decisions: [] } }) {
      const request = buildMigrationRequest(prepared, mode, mergeDecisions);
      generation += 1; const run = generation;
      publish(STATES.EXECUTING, { accountId });
      let result;
      try { result = normalizeRpcResult(await client.rpc("tracker_migrate_v1", { request })); }
      catch (error) { result = transportFailure(error); }
      if (run !== generation) return current;
      if (!result.ok) {
        if (result.outcome === "conflict") { publish(STATES.CONFLICT, { accountId, error: { code: "review_stale" } }); await onConflict(accountId); return current; }
        return publish(STATES.FAILURE, { accountId, error: result.error || { code: result.outcome } });
      }
      let verification;
      try { verification = await verify({ mode, prepared, rpcData: result.data }); }
      catch { verification = { ok: false, code: "verification_failed" }; }
      if (run !== generation) return current;
      if (!verification.ok) return publish(STATES.FAILURE, { accountId, error: { code: verification.code } });
      if (mode === "keep_cloud" && markerStore) {
        try { await markerStore.write(accountId, prepared.sourceChecksum); }
        catch { return publish(STATES.FAILURE, { accountId, error: { code: "marker_unavailable" } }); }
      }
      return publish(STATES.CLOUD_READ_ONLY, { accountId, cloudShows: verification.cloudShows });
    }
    return Object.freeze({ clear, execute, getState: () => current, verify });
  }

  return Object.freeze({ ENVELOPE_KEYS, MIGRATION_KEY, MODES, STATES, buildMigrationRequest, createMigrationExecutionService, normalizeRpcResult, transportFailure });
});
