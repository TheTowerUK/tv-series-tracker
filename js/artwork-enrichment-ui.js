(function artworkEnrichmentUiModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_ARTWORK_ENRICHMENT_UI = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  function posterUrl(path) {
    return typeof path === "string" && path.startsWith("/") ? `https://image.tmdb.org/t/p/w500${path}` : "";
  }

  function proposal(show, candidate, source) {
    return Object.freeze({
      showId: show.id,
      trackerTitle: show.title,
      selectedTmdbId: candidate.id,
      selectedTmdbName: candidate.name,
      selectedFirstAirDate: candidate.firstAirDate,
      posterPath: candidate.posterPath,
      posterUrl: posterUrl(candidate.posterPath),
      source
    });
  }

  function safeErrorMessage(error) {
    const outcome = error && error.outcome;
    if (outcome === "rate_limited") return "Artwork discovery is temporarily limited. Resume after the indicated wait.";
    if (outcome === "unauthenticated") return "Your sign-in is no longer available. Sign in again before resuming.";
    if (outcome === "network_unavailable") return "Artwork discovery could not reach the service.";
    if (outcome === "configuration_unavailable") return "Artwork discovery is not currently configured.";
    return "Artwork discovery could not complete this search.";
  }

  function applicationStopMessage(reason) {
    if (reason === "cancelled") return "Artwork application was cancelled between updates.";
    if (reason === "conflict") return "Artwork application stopped because a cloud show changed. Review the conflict before resuming.";
    if (reason === "cloud_stale_readonly") return "Artwork application stopped because the latest cloud result could not be confirmed safely.";
    if (reason === "device_read_failed") return "Artwork application could not read the current device tracker.";
    if (reason === "device_write_failed") return "Artwork application could not save the updated device tracker.";
    return reason ? "Artwork application stopped safely." : "Artwork update complete.";
  }

  function countsFor(results) {
    const count = (classification) => results.filter((item) => item.classification === classification).length;
    return {
      confidentProposals: count("confident"),
      needsReview: count("needs_review"),
      noMatch: count("no_match"),
      errors: count("error")
    };
  }

  function selectedProposals(results, selections) {
    return Object.freeze(results
      .filter((item) => selections.has(item.show.id))
      .map((item) => {
        const selection = selections.get(item.show.id);
        return proposal(item.show, selection.candidate, selection.source);
      })
      .sort((left, right) => left.showId < right.showId ? -1 : left.showId > right.showId ? 1 : 0));
  }

  function createArtworkEnrichmentReview({ document, discovery, application, artworkEngine, auth = null, getShows, getAuthority, candidateView } = {}) {
    if (!document || !discovery || typeof discovery.discover !== "function" || typeof getShows !== "function" ||
        typeof getAuthority !== "function" || !application || typeof application.apply !== "function" ||
        typeof application.resume !== "function" || typeof application.cancel !== "function" || typeof application.reset !== "function" ||
        !artworkEngine || typeof artworkEngine.hasArtwork !== "function" ||
        !candidateView || typeof candidateView.candidateElement !== "function") {
      throw new TypeError("Artwork review dependencies are required");
    }
    const byId = (id) => document.getElementById(id);
    const els = {
      action: byId("findMissingArtworkBtn"), dialog: byId("artworkEnrichmentDialog"), close: byId("closeArtworkEnrichmentBtn"),
      authority: byId("artworkAuthorityLabel"), progress: byId("artworkDiscoveryProgress"), progressBar: byId("artworkDiscoveryProgressBar"),
      counts: byId("artworkDiscoveryCounts"), status: byId("artworkDiscoveryStatus"), cancel: byId("cancelArtworkDiscoveryBtn"),
      resume: byId("resumeArtworkDiscoveryBtn"), results: byId("artworkDiscoveryResults"), selected: byId("artworkSelectedSummary"),
      done: byId("closeArtworkReviewBtn"), apply: byId("applySelectedArtworkBtn"),
      cancelApply: byId("cancelArtworkApplicationBtn"), resumeApply: byId("resumeArtworkApplicationBtn")
    };
    if (Object.values(els).some((element) => !element)) throw new TypeError("Artwork review elements are required");

    let abortController = null;
    let running = false;
    let applying = false;
    let session = null;
    let accountId = null;
    const selections = new Map();

    function authenticated() { return auth && auth.getState().status === "authenticated"; }
    function missingCount() { return getShows().filter((show) => !artworkEngine.hasArtwork(show)).length; }
    function updateEntryPoint() {
      const available = authenticated();
      els.action.classList.toggle("hidden", !available);
      const missing = available ? missingCount() : 0;
      els.action.textContent = `Find missing artwork${available ? ` (${missing})` : ""}`;
      els.action.disabled = running || applying || missing === 0;
    }

    function setHidden(element, hidden) { element.classList.toggle("hidden", hidden); }
    function progressText(processed, eligible) { return `Processed ${processed} of ${eligible}`; }
    function renderProgress(progress, baseResults = []) {
      const base = countsFor(baseResults);
      const processed = baseResults.length + progress.processed;
      const eligible = session ? session.eligible : progress.eligible;
      els.progress.textContent = progressText(processed, eligible);
      els.progressBar.max = Math.max(eligible, 1);
      els.progressBar.value = processed;
      els.counts.textContent = `Already have artwork: ${session ? session.alreadyHaveArtwork : progress.alreadyHaveArtwork} · Missing: ${eligible} · Confident: ${base.confidentProposals + progress.confidentProposals} · Needs review: ${base.needsReview + progress.needsReview} · No match: ${base.noMatch + progress.noMatch} · Errors: ${base.errors + progress.errors}`;
    }

    function category(title, items, renderItem) {
      const section = document.createElement("section");
      section.className = "artwork-result-category";
      const heading = document.createElement("h3");
      heading.textContent = `${title} (${items.length})`;
      section.appendChild(heading);
      if (!items.length) {
        const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "None"; section.appendChild(empty);
      } else items.forEach((item) => section.appendChild(renderItem(item)));
      return section;
    }

    function itemShell(item) {
      const article = document.createElement("article"); article.className = "artwork-review-item"; article.dataset.showId = item.show.id;
      const heading = document.createElement("div"); heading.className = "artwork-review-heading";
      const title = document.createElement("strong"); title.textContent = item.show.title;
      const year = document.createElement("span"); year.textContent = String(item.show.firstAirDate || "").slice(0, 4) || "Year unknown";
      heading.append(title, year); article.appendChild(heading); return article;
    }

    function renderConfident(item) {
      const article = itemShell(item);
      const label = document.createElement("label"); label.className = "artwork-proposal-toggle";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selections.has(item.show.id);
      const text = document.createElement("span"); text.textContent = "Keep this proposal selected for application";
      label.append(checkbox, text); article.appendChild(label);
      article.appendChild(candidateView.candidateElement({ document, candidate: item.proposal, label: "Proposed — not saved" }));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selections.set(item.show.id, { candidate: item.proposal, source: "confident" });
        else selections.delete(item.show.id);
        renderSelectedSummary();
      });
      return article;
    }

    function renderNeedsReview(item) {
      const article = itemShell(item);
      const note = document.createElement("p"); note.className = "muted"; note.textContent = "Choose a candidate or leave this show unmatched. Nothing is saved during review."; article.appendChild(note);
      const current = selections.get(item.show.id);
      item.candidates.forEach((candidate) => article.appendChild(candidateView.candidateElement({
        document, candidate, label: current && current.candidate.id === candidate.id ? "Selected for review" : "Select candidate",
        selected: Boolean(current && current.candidate.id === candidate.id),
        onSelect: () => { selections.set(item.show.id, { candidate, source: "manual_review" }); renderResults(); }
      })));
      const leave = document.createElement("button"); leave.type = "button"; leave.className = "text-btn"; leave.textContent = "Leave unmatched";
      leave.addEventListener("click", () => { selections.delete(item.show.id); renderResults(); }); article.appendChild(leave);
      return article;
    }

    function renderNoMatch(item) {
      const article = itemShell(item); const text = document.createElement("p"); text.className = "muted"; text.textContent = "No suitable artwork was found."; article.appendChild(text); return article;
    }
    function renderError(item) {
      const article = itemShell(item); const text = document.createElement("p"); text.className = "muted"; text.textContent = safeErrorMessage(item.error); article.appendChild(text); return article;
    }
    function renderSelectedSummary() {
      const count = session ? selectedProposals(session.results, selections).length : 0;
      const applicationState = application.getState();
      const hasPendingApplication = applicationState.remaining > 0 && ["cancelled", "conflict", "cloud_stale_readonly"].includes(applicationState.stoppedReason);
      const completed = applicationState.applied + applicationState.skipped + applicationState.conflicted + applicationState.failed;
      els.selected.textContent = completed
        ? `${applicationState.applied} applied · ${applicationState.skipped} skipped · ${applicationState.conflicted} conflicted · ${applicationState.failed} failed · ${applicationState.remaining} remaining.`
        : `${count} artwork selection${count === 1 ? "" : "s"} selected. No tracker data has changed.`;
      els.apply.textContent = `Apply selected artwork${count ? ` (${count})` : ""}`;
      els.apply.disabled = count === 0 || running || applying || hasPendingApplication || !["local", "cloud_ready"].includes(getAuthority());
    }
    function renderResults() {
      if (!session) return;
      const results = session.results;
      els.results.replaceChildren(
        category("Confident proposals", results.filter((item) => item.classification === "confident"), renderConfident),
        category("Needs review", results.filter((item) => item.classification === "needs_review"), renderNeedsReview),
        category("No match", results.filter((item) => item.classification === "no_match"), renderNoMatch),
        category("Errors", results.filter((item) => item.classification === "error"), renderError)
      );
      renderSelectedSummary();
    }

    function mergeRun(output) {
      const byShow = new Map(session.results.map((item) => [item.show.id, item]));
      output.results.forEach((item) => {
        byShow.set(item.show.id, item);
        if (item.classification === "confident" && !selections.has(item.show.id)) selections.set(item.show.id, { candidate: item.proposal, source: "confident" });
      });
      session.results = [...byShow.values()].sort((left, right) => left.show.id < right.show.id ? -1 : left.show.id > right.show.id ? 1 : 0);
      session.unprocessedIds = output.unprocessed.map((show) => show.id);
      session.stopReason = output.stopReason;
    }

    async function run(runShows) {
      running = true; updateEntryPoint(); setHidden(els.cancel, false); setHidden(els.resume, true); els.done.disabled = true;
      abortController = new AbortController();
      const baseResults = [...session.results];
      const output = await discovery.discover(runShows, { signal: abortController.signal, onProgress: (progress) => renderProgress(progress, baseResults) });
      mergeRun(output); running = false; abortController = null; els.done.disabled = false; setHidden(els.cancel, true);
      const counts = countsFor(session.results);
      renderProgress({ processed: 0, confidentProposals: 0, needsReview: 0, noMatch: 0, errors: 0, eligible: session.eligible }, session.results);
      if (session.stopReason === "rate_limited") {
        els.status.textContent = "Artwork discovery has paused because the service is temporarily limited. Completed results are preserved.";
        setHidden(els.resume, session.unprocessedIds.length === 0);
      } else if (session.stopReason === "cancelled") {
        els.status.textContent = "Discovery cancelled. Completed results are preserved; unprocessed shows were not searched.";
      } else {
        els.status.textContent = `Discovery complete: ${counts.confidentProposals} confident, ${counts.needsReview} need review, ${counts.noMatch} no match, ${counts.errors} errors.`;
      }
      renderResults(); updateEntryPoint();
    }

    function start() {
      if (!authenticated() || running) return;
      application.reset();
      const snapshot = getShows();
      selections.clear();
      session = { authority: getAuthority(), snapshotById: new Map(snapshot.map((show) => [String(show.id), show])), results: [],
        totalShows: snapshot.length, alreadyHaveArtwork: snapshot.filter((show) => artworkEngine.hasArtwork(show)).length,
        eligible: snapshot.filter((show) => !artworkEngine.hasArtwork(show)).length,
        unprocessedIds: snapshot.filter((show) => !artworkEngine.hasArtwork(show)).map((show) => String(show.id)), stopReason: null };
      els.authority.textContent = session.authority.startsWith("cloud_") ? "Reviewing the current cloud tracker" : "Reviewing the current device tracker";
      els.status.textContent = "Searching only shows that do not already have artwork. No tracker data will be changed.";
      els.results.replaceChildren(); renderSelectedSummary();
      if (!els.dialog.open) els.dialog.showModal();
      run(snapshot.filter((show) => !artworkEngine.hasArtwork(show)));
    }

    function cancel() { if (running && abortController) { abortController.abort(); els.status.textContent = "Stopping after the current search finishes…"; } }
    function resume() {
      if (running || !session || session.stopReason !== "rate_limited") return;
      const remaining = session.unprocessedIds.map((id) => session.snapshotById.get(id)).filter(Boolean);
      if (remaining.length) { els.status.textContent = "Resuming unprocessed shows…"; run(remaining); }
    }
    function reset() {
      if (abortController) abortController.abort();
      running = false; applying = false; abortController = null; session = null; selections.clear(); els.results.replaceChildren();
      application.reset();
      if (els.dialog.open) els.dialog.close(); updateEntryPoint();
    }

    els.action.addEventListener("click", start);
    els.cancel.addEventListener("click", cancel);
    els.resume.addEventListener("click", resume);
    els.close.addEventListener("click", () => running ? cancel() : els.dialog.close());
    els.done.addEventListener("click", () => els.dialog.close());
    els.apply.addEventListener("click", async () => {
      const selected = session ? selectedProposals(session.results, selections) : [];
      if (!selected.length || applying) return;
      await application.apply(selected);
    });
    els.cancelApply.addEventListener("click", () => application.cancel());
    els.resumeApply.addEventListener("click", async () => { if (!applying) await application.resume(); });
    if (auth && typeof auth.subscribe === "function") auth.subscribe((state) => {
      const nextAccount = state.status === "authenticated" ? state.accountId : null;
      if (accountId !== null && nextAccount !== accountId) reset();
      accountId = nextAccount; updateEntryPoint();
    }); else updateEntryPoint();

    function handleApplicationProgress(progress) {
      applying = Boolean(progress && progress.running);
      const completed = progress ? progress.applied + progress.skipped + progress.conflicted + progress.failed : 0;
      if (applying) els.status.textContent = `Applying artwork ${Math.min(completed + 1, progress.total)} of ${progress.total}`;
      else if (progress) {
        els.status.textContent = `${applicationStopMessage(progress.stoppedReason)} ${progress.applied} applied · ${progress.skipped} skipped · ${progress.conflicted} conflicted · ${progress.failed} failed · ${progress.remaining} remaining.`;
      }
      setHidden(els.cancelApply, !applying);
      const resumable = !applying && progress && progress.remaining > 0 && ["cancelled", "conflict", "cloud_stale_readonly"].includes(progress.stoppedReason);
      setHidden(els.resumeApply, !resumable);
      els.resumeApply.disabled = !resumable || getAuthority() !== "cloud_ready" && getAuthority() !== "local";
      els.done.disabled = applying;
      renderSelectedSummary();
      updateEntryPoint();
    }

    function refreshApplicationControls() {
      const progress = application.getState();
      const resumable = !progress.running && progress.remaining > 0 && ["cancelled", "conflict", "cloud_stale_readonly"].includes(progress.stoppedReason);
      setHidden(els.resumeApply, !resumable);
      els.resumeApply.disabled = !resumable || !["local", "cloud_ready"].includes(getAuthority());
      renderSelectedSummary();
    }

    return Object.freeze({ getSelectedProposals: () => session ? selectedProposals(session.results, selections) : Object.freeze([]),
      handleApplicationProgress, refreshAvailability: () => { updateEntryPoint(); refreshApplicationControls(); }, reset, start });
  }

  return Object.freeze({ applicationStopMessage, countsFor, createArtworkEnrichmentReview, posterUrl, proposal, safeErrorMessage, selectedProposals });
});
