"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createCloudTrackerRepository } = require("../../js/cloud-tracker-repository.js");
const { trackerChecksum } = require("../../js/tracker-checksum.js");
const { validateParsedSource } = require("../../js/migration-source.js");
const review = require("../../js/migration-review.js");
const execution = require("../../js/migration-execution.js");
const { STATES: MIGRATION_STATES, createMigrationStateService } = require("../../js/migration-state.js");

function loadSupabase() {
  const context = { AbortController, Blob, FormData, Headers, Request, Response, TextDecoder, TextEncoder,
    URL, URLSearchParams, atob, btoa, clearInterval, clearTimeout, console, crypto, fetch, setInterval, setTimeout };
  context.WebSocket = class LocalTestWebSocket {}; context.globalThis = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../vendor/supabase-js/2.112.3/supabase.js"), "utf8"), context);
  return context.supabase;
}
const url = process.env.TV_TRACKER_TEST_SUPABASE_URL;
const publishableKey = process.env.TV_TRACKER_TEST_PUBLISHABLE_KEY;
const secretKey = process.env.TV_TRACKER_TEST_SECRET_KEY;
const enabled = Boolean(url && publishableKey && secretKey);

function validated(payload) {
  const source = validateParsedSource(payload, "local_storage");
  assert.equal(source.ok, true);
  return source;
}
async function prepare(source, repository) {
  const cloud = await repository.readTracker(); assert.equal(cloud.ok, true);
  return { status: "review_required", source, sourceChecksum: await trackerChecksum(source.normalizedPayload),
    cloudChecksum: await trackerChecksum(review.cloudTrackerPayload(cloud.data.shows)), cloudShows: cloud.data.shows };
}

test("local Supabase executes keep, 352-show replace, reviewed merge and stale conflict", { skip: !enabled, timeout: 180000 }, async () => {
  const supabase = loadSupabase();
  const admin = supabase.createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const packaged = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../data/shows.json"), "utf8"));
  const basePayload = { schemaVersion: 1, shows: packaged.shows };
  const identities = [], suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Local-only-${suffix}-A1!`;
  try {
    for (const label of ["keep", "replace"]) {
      const email = `phase25-execute-${label}-${suffix}@example.test`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.equal(created.error, null);
      const client = supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      assert.equal((await client.auth.signInWithPassword({ email, password })).error, null);
      identities.push({ id: created.data.user.id, client });
    }

    const keepRepository = createCloudTrackerRepository({ client: identities[0].client });
    const keepPrepared = await prepare(validated(basePayload), keepRepository);
    let markerWrites = 0;
    const keepService = execution.createMigrationExecutionService({ client: identities[0].client, cloudRepository: keepRepository,
      cloudPayload: review.cloudTrackerPayload, checksum: trackerChecksum, markerStore: { async write() { markerWrites += 1; } } });
    assert.equal((await keepService.execute({ accountId: identities[0].id, prepared: keepPrepared, mode: "keep_cloud" })).status, execution.STATES.CLOUD_READ_ONLY);
    assert.deepEqual((await keepRepository.readTracker()).data.totals, { shows: 0, seasons: 0 });
    assert.equal((await keepRepository.readMigrationReceipt()).data.receipt, null); assert.equal(markerWrites, 1);

    const replaceRepository = createCloudTrackerRepository({ client: identities[1].client });
    const replacePrepared = await prepare(validated(basePayload), replaceRepository);
    assert.equal(replacePrepared.sourceChecksum, "3bcfde529f776d4bb3a1a252c2673e80d0c305b3e7869e1c54d63813ca617d33");
    const replaceService = execution.createMigrationExecutionService({ client: identities[1].client, cloudRepository: replaceRepository,
      cloudPayload: review.cloudTrackerPayload, checksum: trackerChecksum });
    assert.equal((await replaceService.execute({ accountId: identities[1].id, prepared: replacePrepared, mode: "replace_cloud" })).status, execution.STATES.CLOUD_READ_ONLY);
    const replaced = await replaceRepository.readTracker(); assert.deepEqual(replaced.data.totals, { shows: 352, seasons: 1028 });
    assert.equal(await trackerChecksum(review.cloudTrackerPayload(replaced.data.shows)), replacePrepared.sourceChecksum);
    assert.equal((await replaceRepository.readMigrationReceipt()).data.receipt.resultChecksum, replacePrepared.sourceChecksum);

    const restoredState = createMigrationStateService({ sourceInspector: () => validated(basePayload), checksum: trackerChecksum,
      cloudRepository: replaceRepository, cloudPayload: review.cloudTrackerPayload,
      diffBuilder: review.buildMigrationDiff, storage: {}, baseline: [] });
    assert.equal((await restoredState.applyAuthState({ status: "authenticated", accountId: identities[1].id })).status, MIGRATION_STATES.COMPLETED);
    assert.equal(restoredState.getState().cloudShows.length, 352);

    let interruptedRead = true, recoveredState = null;
    const interruptedRepository = {
      async readTracker() { if (interruptedRead) { interruptedRead = false; return { ok: false, error: { code: "network_unavailable" } }; } return replaceRepository.readTracker(); },
      async readMigrationReceipt() { return replaceRepository.readMigrationReceipt(); }
    };
    const interruptedService = execution.createMigrationExecutionService({ client: identities[1].client,
      cloudRepository: interruptedRepository, cloudPayload: review.cloudTrackerPayload, checksum: trackerChecksum,
      onFailure: async () => { recoveredState = await restoredState.inspect(identities[1].id); } });
    const currentPrepared = await prepare(validated(basePayload), replaceRepository);
    assert.equal((await interruptedService.execute({ accountId: identities[1].id, prepared: currentPrepared, mode: "replace_cloud" })).status, execution.STATES.FAILURE);
    assert.equal(recoveredState.status, MIGRATION_STATES.COMPLETED);
    assert.equal(recoveredState.cloudShows.length, 352);

    const changedPayload = JSON.parse(JSON.stringify(basePayload)); changedPayload.shows[0].title += " — reviewed";
    const mergePrepared = await prepare(validated(changedPayload), replaceRepository);
    const changedItem = review.buildMigrationDiff(mergePrepared.source.normalizedPayload, mergePrepared.cloudShows)
      .find(item => item.entityType === "show" && item.kind === "changed");
    const decisions = review.decisionsFromSelections([changedItem], { [changedItem.id]: "apply_local_record" });
    const mergeService = execution.createMigrationExecutionService({ client: identities[1].client, cloudRepository: replaceRepository,
      cloudPayload: review.cloudTrackerPayload, checksum: trackerChecksum });
    assert.equal((await mergeService.execute({ accountId: identities[1].id, prepared: mergePrepared, mode: "reviewed_merge", mergeDecisions: decisions })).status, execution.STATES.CLOUD_READ_ONLY);
    const merged = await replaceRepository.readTracker(); assert.equal(merged.data.shows.find(show => show.legacyId === "tv-0001").title.endsWith("— reviewed"), true);
    assert.equal(merged.data.shows.find(show => show.legacyId === "tv-0002").title, packaged.shows[1].title);

    const stalePrepared = await prepare(validated(changedPayload), replaceRepository);
    const first = stalePrepared.cloudShows[0];
    const mutation = await identities[1].client.rpc("tracker_update_show", { request: { showId: first.id, expectedRevision: first.revision, showPatch: { synopsis: `${first.description} stale change` } } });
    assert.equal(mutation.data.outcome, "success");
    const staleResult = await replaceService.execute({ accountId: identities[1].id, prepared: stalePrepared, mode: "replace_cloud" });
    assert.equal(staleResult.status, execution.STATES.CONFLICT);
  } finally {
    for (const identity of identities) await admin.auth.admin.deleteUser(identity.id);
  }
});
