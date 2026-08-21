(function migrationReviewUi(root) {
  "use strict";
  if (!root || !root.document) return;
  const auth = root.TV_TRACKER_AUTH, bootstrap = root.TV_TRACKER_SUPABASE;
  const repositories = root.TV_TRACKER_CLOUD_REPOSITORY, source = root.TV_TRACKER_MIGRATION_SOURCE;
  const checksum = root.TV_TRACKER_CHECKSUM, review = root.TV_TRACKER_MIGRATION_REVIEW_MODEL;
  const migration = root.TV_TRACKER_MIGRATION_STATE, marker = root.TV_TRACKER_MIGRATION_MARKER;
  const execution = root.TV_TRACKER_MIGRATION_EXECUTION, app = root.TV_TRACKER_APP;
  const panel = root.document.getElementById("migrationReview");
  if (!auth || !panel || !bootstrap || !repositories || !source || !checksum || !review || !migration || !marker || !execution || !app) return;

  const els = { status: root.document.getElementById("migrationReviewStatus"), choices: root.document.getElementById("migrationChoices"),
    differences: root.document.getElementById("migrationDifferences"), list: root.document.getElementById("migrationDifferenceList"),
    summary: root.document.getElementById("migrationDecisionSummary"), backup: root.document.getElementById("migrationBackupBtn"),
    execute: root.document.getElementById("migrationExecuteBtn") };
  const cloudRepository = repositories.createCloudTrackerRepository({ client: bootstrap.getClient() });
  const markerStore = marker.createKeepCloudMarkerStore({ storage: root.localStorage, sha256Hex: checksum.sha256Hex });
  let selectedMode = null, selections = {};

  const stateService = migration.createMigrationStateService({ sourceInspector: source.inspectMigrationSource,
    checksum: checksum.trackerChecksum, cloudRepository, cloudPayload: review.cloudTrackerPayload,
    diffBuilder: review.buildMigrationDiff, markerStore, storage: root.localStorage,
    baseline: root.TV_TRACKER_BASELINE, onStateChange: renderReview });
  const executionService = execution.createMigrationExecutionService({ client: bootstrap.getClient(), cloudRepository,
    cloudPayload: review.cloudTrackerPayload, checksum: checksum.trackerChecksum, markerStore,
    onConflict: async accountId => stateService.inspect(accountId), onStateChange: renderExecution });

  function hidden(element, value) { if (element) element.classList.toggle("hidden", value); }
  function resetChoice() { selectedMode = null; selections = {}; els.execute.disabled = true; }
  function showLocal() { app.returnToLocal(); }

  function renderReview(state) {
    panel.dataset.migrationState = state.status;
    hidden(panel, [migration.STATES.IDLE, migration.STATES.COMPLETED, migration.STATES.KEEP_DISMISSED].includes(state.status));
    hidden(els.choices, state.status !== migration.STATES.REVIEW_REQUIRED); hidden(els.differences, true); resetChoice();
    if (state.status === migration.STATES.IDLE) showLocal();
    else if (state.status === migration.STATES.LOADING) els.status.textContent = "Inspecting this device and your private cloud tracker…";
    else if (state.status === migration.STATES.SOURCE_ERROR) els.status.textContent = "Device tracker data cannot be safely reviewed. Cloud replacement and merge are unavailable; your local tracker is unchanged.";
    else if (state.status === migration.STATES.CLOUD_ERROR) els.status.textContent = "Cloud tracker data could not be inspected safely. Try again after checking your connection.";
    else if (state.status === migration.STATES.REVIEW_REQUIRED) els.status.textContent = "Choose how this device should relate to your existing cloud tracker. Review and confirm before anything changes.";
    else if ([migration.STATES.COMPLETED, migration.STATES.KEEP_DISMISSED].includes(state.status)) app.setCloudReadOnly(state.cloudShows || []);
  }

  function renderExecution(state) {
    if (state.status === execution.STATES.EXECUTING) { els.status.textContent = "Applying your confirmed choice and independently verifying the result…"; els.execute.disabled = true; }
    else if (state.status === execution.STATES.CONFLICT) { showLocal(); els.status.textContent = "Cloud data changed during review. The latest state is being refreshed; review your choice again."; }
    else if (state.status === execution.STATES.FAILURE) { showLocal(); els.status.textContent = state.error && state.error.code === "unauthenticated"
      ? "Your session expired. Sign in again; device data remains unchanged."
      : "The migration could not be safely verified. Device data remains unchanged; retry after checking your session and connection."; els.execute.disabled = false; }
    else if (state.status === execution.STATES.CLOUD_READ_ONLY) { app.setCloudReadOnly(state.cloudShows || []); hidden(panel, true); }
    else if (state.status === execution.STATES.IDLE) showLocal();
  }

  function showReviewedMerge(state) {
    hidden(els.differences, false); els.list.replaceChildren();
    for (const entry of state.reviewItems) {
      const row = root.document.createElement("label"); row.className = "migration-difference";
      const copy = root.document.createElement("span"), strong = root.document.createElement("strong"), small = root.document.createElement("small");
      strong.textContent = entry.label; small.textContent = entry.kind === "local_only" ? "Only on this device" : entry.kind === "cloud_only" ? "Only in cloud" : "Device and cloud differ"; copy.append(strong, small);
      const select = root.document.createElement("select"); select.dataset.reviewItem = entry.id; select.setAttribute("aria-label", `Review ${entry.label}`);
      select.append(new Option("Leave unchanged", ""));
      for (const action of entry.actions) select.append(new Option(review.ACTION_LABELS[action], action));
      select.addEventListener("change", () => { if (select.value) selections[entry.id] = select.value; else delete selections[entry.id];
        try { const generated = review.decisionsFromSelections(state.reviewItems, selections); els.summary.textContent = `${generated.decisions.length} explicit cloud change${generated.decisions.length === 1 ? "" : "s"} selected. Unmentioned records stay unchanged.`; }
        catch { select.value = ""; delete selections[entry.id]; els.summary.textContent = "That combination is not safe. Review the parent show choice first."; } });
      row.append(copy, select); els.list.append(row);
    }
    els.summary.textContent = "No cloud changes selected. Unmentioned cloud stays unchanged and unmentioned device data is ignored.";
  }

  panel.addEventListener("click", async event => {
    const choiceButton = event.target.closest("[data-migration-choice]");
    if (choiceButton) {
      const state = stateService.getState(); if (state.status !== migration.STATES.REVIEW_REQUIRED) return;
      selectedMode = choiceButton.dataset.migrationChoice; selections = {}; els.execute.disabled = false;
      if (selectedMode === "reviewed_merge") showReviewedMerge(state);
      else { hidden(els.differences, false); els.list.replaceChildren(); els.summary.textContent = selectedMode === "keep_cloud"
        ? "Cloud will remain unchanged. After verification, this device will display that cloud tracker read-only."
        : "Cloud will exactly match this validated device snapshot. This can remove cloud records absent here."; }
      return;
    }
    if (event.target.closest("#migrationBackupBtn")) { app.exportLocalBackup(); return; }
    if (!event.target.closest("#migrationExecuteBtn") || !selectedMode) return;
    const prepared = stateService.getState(); if (prepared.status !== migration.STATES.REVIEW_REQUIRED) return;
    let decisions = { decisions: [] };
    try { if (selectedMode === "reviewed_merge") decisions = review.decisionsFromSelections(prepared.reviewItems, selections); }
    catch { els.status.textContent = "Review selections are incomplete or contradictory."; return; }
    await executionService.execute({ accountId: prepared.accountId, prepared, mode: selectedMode, mergeDecisions: decisions });
  });

  auth.subscribe(authState => { if (authState.status !== "authenticated") executionService.clear(); stateService.applyAuthState(authState); });
  root.TV_TRACKER_MIGRATION_REVIEW = Object.freeze({ executionService, markerStore, service: stateService,
    getPreparedDecisions: () => review.decisionsFromSelections(stateService.getState().reviewItems || [], selections) });
})(typeof globalThis === "object" ? globalThis : this);
