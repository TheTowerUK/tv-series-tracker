(function seasonConflictReviewModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_SEASON_CONFLICT_REVIEW = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  function createSeasonConflictModel(conflict) {
    if (!conflict || !conflict.submission || !conflict.context) return null;
    const operation = conflict.submission.operation;
    if (!["createSeason", "updateSeason", "deleteSeason"].includes(operation)) return null;
    const current = conflict.currentRecord || null;
    const parent = conflict.parentRecord || null;
    const submittedSeason = conflict.submission.args && conflict.submission.args[1] || null;
    const proposedStatus = conflict.submission.submitted && conflict.submission.submitted.proposedStatus || submittedSeason && submittedSeason.status || null;
    const maximum = parent && parent.seasons.length ? Math.max(...parent.seasons.map((season) => season.number)) : 0;
    return Object.freeze({
      kind: operation === "createSeason" ? "create" : operation === "deleteSeason" ? "delete" : "update",
      current,
      parent,
      proposedStatus,
      removed: !current,
      isFinal: Boolean(current && current.number === maximum),
      currentStatus: current && current.status || null
    });
  }

  function createSeasonConflictReview({ document, onUseCurrent, onReview, onRetry, onCancel } = {}) {
    if (!document) throw new TypeError("A document is required");
    const dialog = document.getElementById("seasonConflictDialog");
    const message = document.getElementById("seasonConflictMessage");
    const values = document.getElementById("seasonConflictValues");
    const useCurrent = document.getElementById("seasonConflictUseCurrent");
    const review = document.getElementById("seasonConflictReviewChange");
    const retry = document.getElementById("seasonConflictRetry");
    const cancel = document.getElementById("seasonConflictCancel");
    if (!dialog || !message || !values || !useCurrent || !review || !retry || !cancel) throw new TypeError("Season conflict UI is incomplete");
    let active = null;

    function close() { if (dialog.open) dialog.close(); active = null; }
    function show(conflict) {
      const model = createSeasonConflictModel(conflict);
      if (!model) return false;
      active = model;
      retry.classList.add("hidden"); useCurrent.classList.remove("hidden");
      values.replaceChildren();
      if (model.kind === "create") {
        message.textContent = "This season was added on another device. The current cloud tracker has been refreshed.";
        review.classList.add("hidden");
      } else if (model.removed) {
        message.textContent = "This season is no longer available in the current cloud tracker.";
        review.classList.add("hidden");
      } else if (model.kind === "delete") {
        message.textContent = model.isFinal
          ? "This season changed since deletion was requested. Review it before confirming deletion again."
          : "This season changed and is no longer the final season, so deletion is unavailable.";
        review.textContent = "Review current season";
        review.classList.toggle("hidden", !model.isFinal);
      } else {
        message.textContent = "This season changed on another device. Review the current cloud status before retrying.";
        review.textContent = "Review my change";
        review.classList.remove("hidden");
        const current = document.createElement("p"); current.textContent = `Current cloud status: ${model.currentStatus}`;
        const proposed = document.createElement("p"); proposed.textContent = `Your proposed status: ${model.proposedStatus}`;
        values.append(current, proposed);
      }
      if (!dialog.open) dialog.showModal();
      return true;
    }

    function confirmRetry(model) {
      active = model;
      values.replaceChildren(); useCurrent.classList.add("hidden"); review.classList.add("hidden"); retry.classList.remove("hidden");
      message.textContent = model.kind === "delete"
        ? "Confirm deletion of the refreshed final season."
        : `Confirm changing the refreshed season from ${model.currentStatus} to ${model.proposedStatus}.`;
      retry.textContent = model.kind === "delete" ? "Delete final season" : "Apply reviewed change";
      if (!dialog.open) dialog.showModal();
    }

    useCurrent.addEventListener("click", () => { const model = active; close(); if (model) onUseCurrent(model); });
    review.addEventListener("click", () => { const model = active; if (model) onReview(model); });
    retry.addEventListener("click", () => { const model = active; close(); if (model) onRetry(model); });
    cancel.addEventListener("click", () => { close(); if (onCancel) onCancel(); });
    return Object.freeze({ close, confirmRetry, show });
  }

  return Object.freeze({ createSeasonConflictModel, createSeasonConflictReview });
});
