"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  RECEIPT_COLUMNS,
  SEASON_COLUMNS,
  SHOW_COLUMNS,
  V1_MIGRATION_KEY,
  createCloudTrackerRepository,
  safeError
} = require("../../js/cloud-tracker-repository.js");

function showRow(id = "00000000-0000-4000-8000-000000000001") {
  return { id, legacy_id: "tv-1", platform: "TV", title: "Cloud", first_air_date: null, synopsis: "", poster_url: null, tmdb_id: null, tmdb_poster_path: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", revision: "1" };
}

function seasonRow(number) {
  return { id: `00000000-0000-4000-9000-${String(number).padStart(12, "0")}`, show_id: "00000000-0000-4000-8000-000000000001", season_number: number, status: "not_started", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", revision: "1" };
}

function fakeClient({ shows = [], seasons = [], receipt = null, errors = {} } = {}) {
  const calls = [];
  const data = { shows, season_progress: seasons };
  return {
    calls,
    from(table) {
      calls.push({ method: "from", table });
      const state = { table, columns: null, order: [], filters: [], limit: null };
      const builder = {
        select(columns) { state.columns = columns; calls.push({ method: "select", table, columns }); return builder; },
        order(column, options) { state.order.push([column, options]); calls.push({ method: "order", table, column, options }); return builder; },
        eq(column, value) { state.filters.push([column, value]); calls.push({ method: "eq", table, column, value }); return builder; },
        limit(value) { state.limit = value; calls.push({ method: "limit", table, value }); return builder; },
        async range(from, to) {
          calls.push({ method: "range", table, from, to });
          if (errors[table]) return { data: null, error: errors[table] };
          return { data: data[table].slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          calls.push({ method: "maybeSingle", table });
          if (errors[table]) return { data: null, error: errors[table] };
          return { data: receipt, error: null };
        }
      };
      return builder;
    }
  };
}

test("uses explicit columns and deterministic pagination without owner filters", async () => {
  const client = fakeClient({ shows: [showRow()], seasons: Array.from({ length: 1000 }, (_, index) => seasonRow(index + 1)) });
  const repository = createCloudTrackerRepository({ client, pageSize: 400 });
  const result = await repository.readTracker();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.totals, { shows: 1, seasons: 1000 });
  assert.equal(result.data.shows[0].seasons.length, 1000);
  const selects = client.calls.filter((call) => call.method === "select");
  assert.deepEqual(selects.filter((call) => call.table === "shows").map((call) => call.columns), [SHOW_COLUMNS]);
  assert.equal(selects.filter((call) => call.table === "season_progress").every((call) => call.columns === SEASON_COLUMNS), true);
  assert.deepEqual(client.calls.filter((call) => call.method === "order" && call.table === "shows").map((call) => call.column), ["id"]);
  assert.deepEqual(client.calls.filter((call) => call.method === "order" && call.table === "season_progress").map((call) => call.column), ["show_id", "season_number", "show_id", "season_number", "show_id", "season_number"]);
  assert.deepEqual(client.calls.filter((call) => call.method === "range" && call.table === "season_progress").map(({ from, to }) => [from, to]), [[0, 399], [400, 799], [800, 1199]]);
  assert.equal(client.calls.some((call) => call.method === "eq" && call.column === "user_id"), false);
});

test("receipt lookup selects explicit fields and the exact migration key only", async () => {
  const receipt = { migration_key: V1_MIGRATION_KEY, source_schema_version: 1, completed_at: "2026-01-01T00:00:00.000Z", source_checksum: "a".repeat(64), result_checksum: "b".repeat(64), imported_show_count: 352, imported_season_count: 1028 };
  const client = fakeClient({ receipt });
  const result = await createCloudTrackerRepository({ client }).readMigrationReceipt();
  assert.equal(result.ok, true);
  assert.equal(result.data.receipt.migrationKey, V1_MIGRATION_KEY);
  assert.equal(result.data.receipt.importedSeasonCount, 1028);
  assert.equal(client.calls.find((call) => call.method === "select").columns, RECEIPT_COLUMNS);
  assert.deepEqual(client.calls.filter((call) => call.method === "eq").map(({ column, value }) => [column, value]), [["migration_key", V1_MIGRATION_KEY]]);
});

test("normalizes read errors without exposing raw diagnostics", async () => {
  const client = fakeClient({ errors: { shows: { status: 403, message: "private SQL detail", details: "secret row" } } });
  const result = await createCloudTrackerRepository({ client }).readTracker();
  assert.deepEqual(result.error, { code: "forbidden", entity: "shows" });
  assert.equal(JSON.stringify(result).includes("private SQL detail"), false);
  assert.equal(JSON.stringify(result).includes("secret row"), false);
  assert.deepEqual(safeError(new TypeError("Failed to fetch"), "shows"), { code: "network_unavailable", entity: "shows" });
});

test("cloud capability is read-only and source contains no write operation", () => {
  const repository = createCloudTrackerRepository({ client: fakeClient() });
  assert.deepEqual(repository.capabilities, { trackerRead: true, trackerWrite: false, receiptRead: true });
  assert.equal("writeTracker" in repository, false);
  const source = fs.readFileSync(path.resolve(__dirname, "../../js/cloud-tracker-repository.js"), "utf8");
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(source, /select\s*\(\s*["']\*["']\s*\)/);
});
