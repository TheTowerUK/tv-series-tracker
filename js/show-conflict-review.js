(function showConflictReviewModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_SHOW_CONFLICT_REVIEW = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const FIELDS = Object.freeze([
    ["platform", "Platform"],
    ["title", "Title"],
    ["firstAirDate", "First air date"],
    ["description", "Description"],
    ["posterUrl", "Poster URL"],
    ["tmdbId", "TMDB match"],
    ["tmdbPosterPath", "TMDB poster path"]
  ]);

  function fieldValue(show, key) {
    if (key === "tmdbId") return show && show.tmdb && show.tmdb.id != null ? String(show.tmdb.id) : "";
    if (key === "tmdbPosterPath") return show && show.tmdb && show.tmdb.posterPath ? String(show.tmdb.posterPath) : "";
    return show && show[key] != null ? String(show[key]) : "";
  }

  function createConflictModel(conflict) {
    if (!conflict || !conflict.submission || !conflict.context) return null;
    const operation = conflict.submission.operation;
    if (!["updateShow", "deleteShow"].includes(operation)) return null;
    const current = conflict.currentRecord || null;
    const proposed = operation === "updateShow" && conflict.submission.submitted && conflict.submission.submitted.draft || null;
    return Object.freeze({
      kind: operation === "deleteShow" ? "delete" : "update",
      current,
      proposed,
      removed: !current,
      fields: Object.freeze(operation === "updateShow" ? FIELDS.map(([key, label]) => Object.freeze({
        key, label, current: fieldValue(current, key), proposed: fieldValue(proposed, key), changed: fieldValue(current, key) !== fieldValue(proposed, key)
      })) : [])
    });
  }

  function createConflictReview({ document, onUseCurrent, onReview, onCancel } = {}) {
    if (!document) throw new TypeError("A document is required");
    const dialog = document.getElementById("showConflictDialog");
    const message = document.getElementById("showConflictMessage");
    const comparison = document.getElementById("showConflictComparison");
    const useCurrent = document.getElementById("showConflictUseCurrent");
    const review = document.getElementById("showConflictReviewChanges");
    const cancel = document.getElementById("showConflictCancel");
    if (!dialog || !message || !comparison || !useCurrent || !review || !cancel) throw new TypeError("Conflict review UI is incomplete");
    let active = null;

    function close() { if (dialog.open) dialog.close(); active = null; }
    function show(conflict) {
      const model = createConflictModel(conflict);
      if (!model) return false;
      active = model;
      comparison.innerHTML = "";
      if (model.removed) {
        message.textContent = "This show is no longer available in the current cloud tracker.";
        review.classList.add("hidden");
      } else if (model.kind === "delete") {
        message.textContent = "This show changed since deletion was requested. Review the current cloud version before confirming deletion again.";
        review.textContent = "Review current show";
        review.classList.remove("hidden");
      } else {
        message.textContent = "This show changed on another device. Review the current cloud version before retrying.";
        review.textContent = "Review my changes";
        review.classList.remove("hidden");
        for (const field of model.fields) {
          const row = document.createElement("div");
          row.className = `conflict-field${field.changed ? " changed" : " unchanged"}`;
          const heading = document.createElement("strong"); heading.textContent = field.label;
          const current = document.createElement("div"); current.className = "conflict-value";
          const currentLabel = document.createElement("span"); currentLabel.textContent = "Current cloud";
          const currentValue = document.createElement("p"); currentValue.textContent = field.current || "Not set";
          const proposed = document.createElement("div"); proposed.className = "conflict-value";
          const proposedLabel = document.createElement("span"); proposedLabel.textContent = "Your proposed value";
          const proposedValue = document.createElement("p"); proposedValue.textContent = field.proposed || "Not set";
          current.append(currentLabel, currentValue); proposed.append(proposedLabel, proposedValue); row.append(heading, current, proposed);
          comparison.appendChild(row);
        }
      }
      if (!dialog.open) dialog.showModal();
      return true;
    }

    useCurrent.addEventListener("click", () => { const model = active; close(); if (model) onUseCurrent(model); });
    review.addEventListener("click", () => { const model = active; close(); if (model) onReview(model); });
    cancel.addEventListener("click", () => { close(); if (onCancel) onCancel(); });
    return Object.freeze({ close, show });
  }

  return Object.freeze({ FIELDS, createConflictModel, createConflictReview });
});
