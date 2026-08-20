(function cloudTrackerRepositoryModule(root, factory) {
  "use strict";
  const adapter = root && root.TV_TRACKER_ROW_ADAPTER ||
    (typeof require === "function" ? require("./tracker-row-adapter.js") : null);
  const exported = factory(adapter);
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_CLOUD_REPOSITORY = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule(adapter) {
  "use strict";

  if (!adapter) throw new Error("Tracker row adapter is required");

  const SHOW_COLUMNS = "id,legacy_id,platform,title,first_air_date,synopsis,poster_url,tmdb_id,tmdb_poster_path,created_at,updated_at,revision";
  const SEASON_COLUMNS = "id,show_id,season_number,status,created_at,updated_at,revision";
  const RECEIPT_COLUMNS = "migration_key,source_schema_version,completed_at,source_checksum,result_checksum,imported_show_count,imported_season_count";
  const V1_MIGRATION_KEY = "localstorage-tvSeriesTrackerData.v1";
  const DEFAULT_PAGE_SIZE = 500;

  function safeError(error, entity) {
    const status = error && Number(error.status);
    const message = String(error && error.message || "").toLowerCase();
    let code = "cloud_read_failed";
    if (status === 401) code = "unauthenticated";
    else if (status === 403) code = "forbidden";
    else if (status === 0 || error instanceof TypeError || /fetch|network|offline/.test(message)) code = "network_unavailable";
    return Object.freeze({ code, entity });
  }

  async function readPages({ client, table, columns, order, pageSize }) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      let query = client.from(table).select(columns);
      for (const column of order) query = query.order(column, { ascending: true });
      const result = await query.range(from, from + pageSize - 1);
      if (result.error) return { ok: false, error: safeError(result.error, table) };
      if (!Array.isArray(result.data)) return { ok: false, error: Object.freeze({ code: "invalid_response", entity: table }) };
      rows.push(...result.data);
      if (result.data.length < pageSize) return { ok: true, data: rows };
    }
  }

  function receiptToClient(row) {
    if (!row) return null;
    return Object.freeze({
      migrationKey: row.migration_key,
      sourceSchemaVersion: row.source_schema_version,
      completedAt: row.completed_at,
      sourceChecksum: row.source_checksum,
      resultChecksum: row.result_checksum,
      importedShowCount: row.imported_show_count,
      importedSeasonCount: row.imported_season_count
    });
  }

  function createCloudTrackerRepository({ client, pageSize = DEFAULT_PAGE_SIZE } = {}) {
    if (!client || typeof client.from !== "function") throw new TypeError("A Supabase client is required");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new TypeError("pageSize must be from 1 through 1000");

    return Object.freeze({
      kind: "cloud",
      capabilities: Object.freeze({ trackerRead: true, trackerWrite: false, receiptRead: true }),
      async readTracker() {
        const showResult = await readPages({ client, table: "shows", columns: SHOW_COLUMNS, order: ["id"], pageSize });
        if (!showResult.ok) return Object.freeze({ ok: false, data: null, error: showResult.error });
        const seasonResult = await readPages({ client, table: "season_progress", columns: SEASON_COLUMNS, order: ["show_id", "season_number"], pageSize });
        if (!seasonResult.ok) return Object.freeze({ ok: false, data: null, error: seasonResult.error });
        try {
          return Object.freeze({
            ok: true,
            data: Object.freeze({
              shows: adapter.adaptCloudTracker(showResult.data, seasonResult.data),
              totals: Object.freeze({ shows: showResult.data.length, seasons: seasonResult.data.length })
            }),
            error: null
          });
        } catch {
          return Object.freeze({ ok: false, data: null, error: Object.freeze({ code: "invalid_response", entity: "tracker" }) });
        }
      },
      async readMigrationReceipt(migrationKey = V1_MIGRATION_KEY) {
        if (migrationKey !== V1_MIGRATION_KEY) {
          return Object.freeze({ ok: false, data: null, error: Object.freeze({ code: "invalid_migration_key", entity: "migration_receipt" }) });
        }
        const result = await client
          .from("migration_receipts")
          .select(RECEIPT_COLUMNS)
          .eq("migration_key", migrationKey)
          .limit(1)
          .maybeSingle();
        if (result.error) return Object.freeze({ ok: false, data: null, error: safeError(result.error, "migration_receipt") });
        return Object.freeze({ ok: true, data: Object.freeze({ receipt: receiptToClient(result.data) }), error: null });
      }
    });
  }

  return Object.freeze({
    DEFAULT_PAGE_SIZE,
    RECEIPT_COLUMNS,
    SEASON_COLUMNS,
    SHOW_COLUMNS,
    V1_MIGRATION_KEY,
    createCloudTrackerRepository,
    safeError
  });
});
