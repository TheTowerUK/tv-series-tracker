"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("ordinary browser writes retain the five-RPC boundary", () => {
  const mutations = read("js/cloud-tracker-mutation-repository.js");
  const app = read("js/app.js");
  const names = [...mutations.matchAll(/tracker_(?:create_show|update_show|delete_show|upsert_season|delete_season)/g)].map((match) => match[0]);
  assert.deepEqual([...new Set(names)].sort(), ["tracker_create_show", "tracker_delete_season", "tracker_delete_show",
    "tracker_update_show", "tracker_upsert_season"]);
  assert.doesNotMatch(app, /\.rpc\s*\(/);
  assert.doesNotMatch(mutations, /tracker_(?:migrate_v1|restore_v2)/);
});

test("cloud authority remains isolated from LocalStorage mutation", () => {
  const app = read("js/app.js");
  assert.match(app, /if\(authority !== "local"\) throw new Error/);
  assert.match(app, /if\(!file \|\| authority !== "local"\) return/);
  assert.match(app, /function resetBaseline\(\)\{\s*if\(authority !== "local"\) return/);
  assert.match(app, /localRepository\.writeTracker/);
  assert.match(app, /cloudController\.mutate/);
  assert.match(app, /TV_TRACKER_CLOUD_MUTATION_REPOSITORY\.buildShowPatch/);
  assert.doesNotMatch(app, /TV_TRACKER_CLOUD_MUTATIONS/);
  assert.doesNotMatch(read("js/cloud-tracker-sync.js"), /localStorage|sessionStorage/);
  assert.doesNotMatch(read("js/cloud-tracker-mutation-repository.js"), /localStorage|sessionStorage/);
});

test("restore, realtime, queues, and TMDB remain outside writable-cloud services", () => {
  const sources = ["js/cloud-tracker-sync.js", "js/cloud-tracker-mutation-repository.js", "js/cloud-tracker-export.js"]
    .map(read).join("\n");
  assert.doesNotMatch(sources, /tracker_restore_v2|BroadcastChannel|Realtime|offline.{0,8}queue|service.role/i);
  assert.doesNotMatch(read("js/cloud-tracker-export.js"), /\.rpc\s*\(|tracker_migrate_v1/);
});

test("cloud export and stale recovery preserve verified-snapshot semantics", () => {
  const app = read("js/app.js");
  const sync = read("js/cloud-tracker-sync.js");
  assert.match(app, /cloudExportBtn\.disabled=!\["cloud_ready","cloud_conflict"\]\.includes\(authority\)/);
  assert.match(app, /prepareCloudExport\(deepCopy\(shows\)\)/);
  assert.match(sync, /state\.status !== STATES\.CLOUD_STALE_READONLY/);
  assert.doesNotMatch(sync.slice(sync.indexOf("async function recover")), /mutationRepository\[/);
});
