(function migrationReviewUi(root) {
  "use strict";
  if (!root || !root.document) return;
  const auth = root.TV_TRACKER_AUTH;
  const bootstrap = root.TV_TRACKER_SUPABASE;
  const repositories = root.TV_TRACKER_CLOUD_REPOSITORY;
  const source = root.TV_TRACKER_MIGRATION_SOURCE;
  const checksum = root.TV_TRACKER_CHECKSUM;
  const review = root.TV_TRACKER_MIGRATION_REVIEW_MODEL;
  const migration = root.TV_TRACKER_MIGRATION_STATE;
  const panel = root.document.getElementById("migrationReview");
  if (!auth || !panel || !bootstrap || !repositories || !source || !checksum || !review || !migration) return;

  const els = { status: root.document.getElementById("migrationReviewStatus"), choices: root.document.getElementById("migrationChoices"),
    differences: root.document.getElementById("migrationDifferences"), list: root.document.getElementById("migrationDifferenceList"),
    summary: root.document.getElementById("migrationDecisionSummary") };
  const cloudRepository = repositories.createCloudTrackerRepository({ client: bootstrap.getClient() });
  const service = migration.createMigrationStateService({ sourceInspector: source.inspectMigrationSource,
    checksum: checksum.trackerChecksum, cloudRepository, cloudPayload: review.cloudTrackerPayload,
    diffBuilder: review.buildMigrationDiff, storage: root.localStorage, baseline: root.TV_TRACKER_BASELINE, onStateChange: render });
  let selections = {};

  function hidden(element, value) { element.classList.toggle("hidden", value); }
  function render(state) {
    panel.dataset.migrationState = state.status;
    hidden(panel, state.status === migration.STATES.IDLE || state.status === migration.STATES.COMPLETED);
    hidden(els.choices, state.status !== migration.STATES.REVIEW_REQUIRED);
    hidden(els.differences, true);
    if (state.status === migration.STATES.LOADING) els.status.textContent = "Inspecting this device and your private cloud tracker…";
    else if (state.status === migration.STATES.SOURCE_ERROR) els.status.textContent = "Device tracker data cannot be safely reviewed. Cloud replacement and merge are unavailable; your local tracker is unchanged.";
    else if (state.status === migration.STATES.CLOUD_ERROR) els.status.textContent = "Cloud tracker data could not be inspected safely. Try again after checking your connection.";
    else if (state.status === migration.STATES.REVIEW_REQUIRED) els.status.textContent = "Review how this device should relate to your existing cloud tracker. Nothing will be changed in this step.";
    selections = {};
  }

  function showReviewedMerge(state) {
    hidden(els.differences, false);
    els.list.replaceChildren();
    for (const entry of state.reviewItems) {
      const row = root.document.createElement("label");
      row.className = "migration-difference";
      const copy = root.document.createElement("span");
      copy.innerHTML = `<strong></strong><small></small>`;
      copy.querySelector("strong").textContent = entry.label;
      copy.querySelector("small").textContent = entry.kind === "local_only" ? "Only on this device" : entry.kind === "cloud_only" ? "Only in cloud" : "Device and cloud differ";
      const select = root.document.createElement("select");
      select.dataset.reviewItem = entry.id;
      select.setAttribute("aria-label", `Review ${entry.label}`);
      select.append(new Option("Leave unchanged", ""));
      for (const action of entry.actions) select.append(new Option(review.ACTION_LABELS[action], action));
      select.addEventListener("change", () => {
        if (select.value) selections[entry.id] = select.value; else delete selections[entry.id];
        try {
          const generated = review.decisionsFromSelections(state.reviewItems, selections);
          els.summary.textContent = `${generated.decisions.length} explicit cloud change${generated.decisions.length === 1 ? "" : "s"} prepared for later confirmation. No changes have been sent.`;
        } catch {
          select.value = ""; delete selections[entry.id];
          els.summary.textContent = "That combination is not safe. Review the parent show choice first.";
        }
      });
      row.append(copy, select); els.list.append(row);
    }
    els.summary.textContent = "No cloud changes selected. Unmentioned records remain unchanged.";
  }

  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-migration-choice]");
    if (!button) return;
    const state = service.getState();
    if (state.status !== migration.STATES.REVIEW_REQUIRED) return;
    const choice = button.dataset.migrationChoice;
    if (choice === "reviewed_merge") showReviewedMerge(state);
    else {
      hidden(els.differences, false); els.list.replaceChildren();
      els.summary.textContent = choice === "keep_cloud" ? "Cloud will remain unchanged. No operation has been sent." :
        "Replacement is selected for review only. No cloud records have been changed or removed.";
    }
  });

  auth.subscribe((authState) => { service.applyAuthState(authState); });
  root.TV_TRACKER_MIGRATION_REVIEW = Object.freeze({ service, getPreparedDecisions: () => review.decisionsFromSelections(service.getState().reviewItems || [], selections) });
})(typeof globalThis === "object" ? globalThis : this);
