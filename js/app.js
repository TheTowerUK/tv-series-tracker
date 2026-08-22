(() => {
  "use strict";

  const VIEW_KEY = "tvSeriesTrackerView.v1";
  const PAGE_SIZE = 60;
  const SEASON_STATUSES = ["Not Started","Watching","Completed","Purchase Only","Region Blocked"];
  const CANONICAL_PLATFORMS = ["Netflix","Prime Video","BBC iPlayer","Disney+","NOW","TV"];

  let baselineShows = [];
  let shows = [];
  let visibleLimit = PAGE_SIZE;
  let pendingTmdbMatch = null;
  let authority = "local";
  const localRepository = window.TV_TRACKER_REPOSITORIES.createLocalTrackerRepository({storage:localStorage});

  const $ = (id) => document.getElementById(id);
  const els = {
    addShowBtn: $("addShowBtn"), exportBtn: $("exportBtn"), cloudExportBtn: $("cloudExportBtn"), importFile: $("importFile"), resetBtn: $("resetBtn"),
    localNote: document.querySelector(".local-note"),
    searchInput: $("searchInput"), platformFilter: $("platformFilter"), statusFilter: $("statusFilter"), sortSelect: $("sortSelect"),
    cardsViewBtn: $("cardsViewBtn"), compactViewBtn: $("compactViewBtn"), clearFiltersBtn: $("clearFiltersBtn"),
    cardsContainer: $("cardsContainer"), emptyState: $("emptyState"), resultCount: $("resultCount"),
    loadMoreWrap: $("loadMoreWrap"), loadMoreBtn: $("loadMoreBtn"),
    statTotal: $("statTotal"), statWatching: $("statWatching"), statCompleted: $("statCompleted"),
    statNotStarted: $("statNotStarted"), statPartial: $("statPartial"), statUnavailable: $("statUnavailable"),
    showDialog: $("showDialog"), showForm: $("showForm"), dialogTitle: $("dialogTitle"), showId: $("showId"),
    platformInput: $("platformInput"), platformOptions: $("platformOptions"), titleInput: $("titleInput"),
    dateInput: $("dateInput"), descriptionInput: $("descriptionInput"), posterInput: $("posterInput"),
    findArtworkBtn: $("findArtworkBtn"), tmdbStatus: $("tmdbStatus"),
    tmdbDialog: $("tmdbDialog"), closeTmdbBtn: $("closeTmdbBtn"), tmdbResults: $("tmdbResults"), tmdbQuerySummary: $("tmdbQuerySummary"),
    seasonEditor: $("seasonEditor"), addSeasonBtn: $("addSeasonBtn"), deleteShowBtn: $("deleteShowBtn"), saveShowBtn: $("saveShowBtn"),
    seasonRowTemplate: $("seasonRowTemplate"), posterPreview: $("posterPreview"),
    detailDialog: $("detailDialog"), closeDetailBtn: $("closeDetailBtn"), detailPoster: $("detailPoster"),
    detailTitle: $("detailTitle"), detailPlatform: $("detailPlatform"), detailStatus: $("detailStatus"),
    detailMeta: $("detailMeta"), detailDescription: $("detailDescription"), detailProgressText: $("detailProgressText"),
    detailProgressFill: $("detailProgressFill"), detailSeasons: $("detailSeasons"), detailEditBtn: $("detailEditBtn"),
    cloudSyncStatus: $("cloudSyncStatus"), cloudSyncMessage: $("cloudSyncMessage"), cloudSyncRetryBtn: $("cloudSyncRetryBtn"),
    cloudConflictDiscardBtn: $("cloudConflictDiscardBtn")
  };

  const statButtons = [...document.querySelectorAll("[data-stat-status]")];
  const statusChips = [...document.querySelectorAll("[data-status-chip]")];
  let cloudController = null;
  let cloudContext = null;
  let conflictReview = null;
  let seasonConflictReview = null;

  function deepCopy(value){ return JSON.parse(JSON.stringify(value)); }
  function save(){
    if(authority !== "local") throw new Error("Local repository writes require local authority.");
    const result = localRepository.writeTracker(shows);
    if(!result.ok) throw new Error("Unable to save tracker data on this device.");
  }

  function load(){
    const baseline = window.TV_TRACKER_BASELINE;
    if(!baseline) throw new Error("Unable to load baseline catalogue.");
    baselineShows = deepCopy(Array.isArray(baseline) ? baseline : baseline.shows || []);
    const result = localRepository.readTracker({baseline:baselineShows});
    shows = deepCopy(result.data.shows);
    refreshPlatformOptions();
    applySavedView();
    setMutationControlsDisabled(false);
    render();
  }

  function cloudAuthority(){ return authority.startsWith("cloud_"); }
  function showWritesReady(){ return authority === "local" || authority === "cloud_ready"; }

  function setEditorControls(){
    const busy = ["cloud_mutating","cloud_refreshing","cloud_conflict","cloud_stale_readonly"].includes(authority);
    [els.saveShowBtn,els.deleteShowBtn,els.findArtworkBtn].forEach(element=>{ if(element) element.disabled=busy; });
    const editingCloudShow = cloudAuthority() && Boolean(els.showId.value);
    if(els.addSeasonBtn) els.addSeasonBtn.disabled = busy || editingCloudShow;
    els.seasonEditor.querySelectorAll(".season-status,.remove-season").forEach(element=>{ element.disabled = busy || editingCloudShow; });
  }

  function setMutationControlsDisabled(disabled){
    const ready = !disabled;
    [els.addShowBtn,els.detailEditBtn].forEach(element=>{ if(element) element.disabled=!ready; });
    [els.importFile,els.resetBtn].forEach(element=>{ if(element) element.disabled=cloudAuthority(); });
    els.cloudExportBtn?.classList.toggle("hidden",!cloudAuthority());
    if(els.cloudExportBtn) els.cloudExportBtn.disabled=!["cloud_ready","cloud_conflict"].includes(authority);
    document.querySelectorAll(".cloud-season-control").forEach(element=>{ element.disabled=authority!=="cloud_ready"; });
    document.body.dataset.trackerAuthority = authority;
    if(els.localNote) els.localNote.textContent = authority === "local"
      ? "Your tracker stays on this device until you sign in and choose how to migrate it."
      : authority === "cloud_ready" ? "Verified cloud data is active. Changes are confirmed from cloud before display."
      : "Verified cloud data remains displayed, but changes are temporarily unavailable.";
    setEditorControls();
  }

  function applyCloudSyncState(state){
    if(!state || !state.status || authority === "local") return;
    authority = state.status;
    if(state.snapshot && ["cloud_ready","cloud_conflict"].includes(state.status)) shows = deepCopy(state.snapshot.shows);
    const stale = state.status === "cloud_stale_readonly", conflict = state.status === "cloud_conflict";
    els.cloudSyncStatus?.classList.toggle("hidden", !stale && !conflict && !["cloud_mutating","cloud_refreshing"].includes(state.status));
    els.cloudSyncRetryBtn?.classList.toggle("hidden", !stale);
    els.cloudConflictDiscardBtn?.classList.toggle("hidden", !conflict);
    if(els.cloudSyncMessage) els.cloudSyncMessage.textContent = stale
      ? "Cloud data cannot currently be updated safely. Refresh before making more changes."
      : conflict ? "This show changed on another device. Review the current cloud version before retrying."
      : state.status === "cloud_mutating" ? "Saving your cloud change…"
      : state.status === "cloud_refreshing" ? "Confirming the latest cloud tracker…" : "";
    setMutationControlsDisabled(state.status !== "cloud_ready");
    if(["cloud_ready","cloud_conflict"].includes(state.status)){ refreshPlatformOptions(); visibleLimit=PAGE_SIZE; render(); }
    if(conflict && state.conflict) {
      conflictReview?.show(state.conflict);
      seasonConflictReview?.show(state.conflict);
    }
    if(stale) { conflictReview?.close(); seasonConflictReview?.close(); }
    if(["cloud_ready","cloud_conflict"].includes(state.status) && els.detailDialog.open) {
      const current=shows.find(show=>show.id===els.detailDialog.dataset.showId); if(current) openDetail(current); else els.detailDialog.close();
    }
  }

  function showCloudFailure(){
    if(!els.cloudSyncStatus||!els.cloudSyncMessage) return;
    els.cloudSyncStatus.classList.remove("hidden");
    els.cloudSyncMessage.textContent="The cloud change could not be completed. Review the form or refresh before trying again.";
  }

  function setCloudWritable({controller,accountId,generation,cloudShows}){
    if(!controller || !accountId || generation == null || !Array.isArray(cloudShows)) throw new TypeError("Verified writable cloud context is required.");
    [els.showDialog,els.detailDialog,els.tmdbDialog].forEach(dialog=>{ if(dialog?.open) dialog.close(); });
    cloudController=controller; cloudContext={accountId,generation}; authority="cloud_ready";
    const snapshot={shows:deepCopy(cloudShows),totals:{shows:cloudShows.length,seasons:cloudShows.reduce((sum,show)=>sum+(show.seasons||[]).length,0)}};
    cloudController.activate({...cloudContext,snapshot});
  }

  function returnToLocal(){
    conflictReview?.close();
    seasonConflictReview?.close();
    cloudController?.invalidate(); cloudController=null; cloudContext=null;
    authority = "local";
    const result = localRepository.readTracker({baseline:baselineShows});
    shows = deepCopy(result.data.shows);
    visibleLimit = PAGE_SIZE;
    refreshPlatformOptions(); clearFilters(); setMutationControlsDisabled(false); render();
    els.cloudSyncStatus?.classList.add("hidden");
  }

  function slug(value){ return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }

  function deriveOverallStatus(show){
    const states = (show.seasons || []).map(s => s.status);
    if(!states.length) return "Not Started";
    if(states.includes("Watching")) return "Watching";
    const progress = states.filter(s => ["Completed","Not Started"].includes(s));
    const unavailable = states.filter(s => ["Purchase Only","Region Blocked"].includes(s));
    if(states.every(s => s === "Completed")) return "Completed";
    if(progress.some(s => s === "Completed") && (progress.some(s => s === "Not Started") || unavailable.length)) return "Partially Watched";
    if(progress.length && progress.every(s => s === "Not Started") && !states.includes("Completed")) return "Not Started";
    if(unavailable.length === states.length) return "Unavailable";
    if(states.includes("Completed")) return "Partially Watched";
    return "Not Started";
  }

  function progressFor(show){
    const seasons = show.seasons || [];
    const completed = seasons.filter(s => s.status === "Completed").length;
    const total = seasons.length;
    return {completed,total,percent:total ? Math.round((completed / total) * 100) : 0};
  }

  function formatDate(iso){
    if(!iso) return "Date not set";
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(d);
  }

  function initials(title){
    const words = String(title || "TV").trim().split(/\s+/).filter(Boolean);
    return (words.slice(0,2).map(w => w[0]).join("") || "TV").toUpperCase();
  }

  function setPosterBackground(element, url, title, placeholderLabel=null){
    if(!element) return;
    element.classList.remove("has-image","image-error");
    element.style.backgroundImage = "";
    const span = element.querySelector("span");
    if(span) span.textContent = placeholderLabel || initials(title);
    const cleanUrl = String(url || "").trim();
    if(!cleanUrl) return;
    const image = new Image();
    image.onload = () => {
      element.style.backgroundImage = `url("${cleanUrl.replace(/"/g,"%22")}")`;
      element.classList.add("has-image");
    };
    image.onerror = () => element.classList.add("image-error");
    image.src = cleanUrl;
  }

  function getFiltered(){
    const q = els.searchInput.value.trim().toLowerCase();
    const platform = els.platformFilter.value;
    const overall = els.statusFilter.value;
    let list = shows.filter(show => {
      const haystack = `${show.title || ""} ${show.description || ""} ${show.platform || ""}`.toLowerCase();
      return (!q || haystack.includes(q)) &&
             (!platform || show.platform === platform) &&
             (!overall || deriveOverallStatus(show) === overall);
    });
    switch(els.sortSelect.value){
      case "dateAsc": list.sort((a,b)=>(a.firstAirDate||"").localeCompare(b.firstAirDate||"")); break;
      case "dateDesc": list.sort((a,b)=>(b.firstAirDate||"").localeCompare(a.firstAirDate||"")); break;
      case "titleDesc": list.sort((a,b)=>(b.title||"").localeCompare(a.title||"",undefined,{sensitivity:"base"})); break;
      case "platformAsc": list.sort((a,b)=>(a.platform||"").localeCompare(b.platform||"",undefined,{sensitivity:"base"}) || (a.title||"").localeCompare(b.title||"",undefined,{sensitivity:"base"})); break;
      default: list.sort((a,b)=>(a.title||"").localeCompare(b.title||"",undefined,{sensitivity:"base"}));
    }
    return list;
  }

  function refreshPlatformOptions(){
    const platforms = [...new Set([...CANONICAL_PLATFORMS, ...shows.map(s=>s.platform).filter(Boolean)])].sort((a,b)=>a.localeCompare(b));
    const current = els.platformFilter.value;
    els.platformFilter.innerHTML = `<option value="">All platforms</option>` + platforms.map(p=>`<option>${escapeHtml(p)}</option>`).join("");
    els.platformFilter.value = platforms.includes(current) ? current : "";
    els.platformOptions.innerHTML = platforms.map(p=>`<option value="${escapeAttr(p)}"></option>`).join("");
  }

  function renderStats(){
    const counts = Counter(shows.map(deriveOverallStatus));
    els.statTotal.textContent = shows.length;
    els.statWatching.textContent = counts["Watching"] || 0;
    els.statCompleted.textContent = counts["Completed"] || 0;
    els.statNotStarted.textContent = counts["Not Started"] || 0;
    els.statPartial.textContent = counts["Partially Watched"] || 0;
    els.statUnavailable.textContent = counts["Unavailable"] || 0;
    statButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.statStatus === els.statusFilter.value));
    statusChips.forEach(btn => btn.classList.toggle("active", btn.dataset.statusChip === els.statusFilter.value));
  }

  function Counter(values){ return values.reduce((acc,v)=>{acc[v]=(acc[v]||0)+1;return acc;},{}); }

  function render(){
    renderStats();
    const list = getFiltered();
    const visible = list.slice(0, visibleLimit);
    const hasFilters = Boolean(els.searchInput.value.trim() || els.platformFilter.value || els.statusFilter.value);
    els.clearFiltersBtn.classList.toggle("hidden", !hasFilters);
    els.resultCount.textContent = list.length > visible.length
      ? `Showing ${visible.length} of ${list.length} matching shows · ${shows.length} total`
      : `${list.length} matching show${list.length===1?"":"s"} · ${shows.length} total`;
    els.cardsContainer.innerHTML = "";
    els.emptyState.classList.toggle("hidden", list.length !== 0);
    visible.forEach(show => els.cardsContainer.appendChild(createCard(show)));
    els.loadMoreWrap.classList.toggle("hidden", visible.length >= list.length);
    if(visible.length < list.length) els.loadMoreBtn.textContent = `Load more (${list.length - visible.length} remaining)`;
  }

  function createCard(show){
    const overall = deriveOverallStatus(show);
    const progress = progressFor(show);
    const article = document.createElement("article");
    article.className = "show-card";
    const poster = document.createElement("div");
    poster.className = "poster";
    poster.innerHTML = `<span>${escapeHtml(initials(show.title))}</span>`;
    setPosterBackground(poster, show.posterUrl, show.title);
    poster.setAttribute("role","button");
    poster.setAttribute("tabindex","0");
    poster.setAttribute("aria-label",`View details for ${show.title || "show"}`);
    poster.addEventListener("click",()=>openDetail(show));
    poster.addEventListener("keydown",e=>{ if(e.key === "Enter" || e.key === " "){ e.preventDefault(); openDetail(show); } });

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <div class="card-top">
        <div>
          <h2 class="card-title">${escapeHtml(show.title || "Untitled")}</h2>
          <p class="platform">${escapeHtml(show.platform || "Unassigned")}</p>
        </div>
        <span class="status-badge ${slug(overall)}">${escapeHtml(overall)}</span>
      </div>
      <p class="date">${escapeHtml(formatDate(show.firstAirDate))} · ${progress.total} season${progress.total===1?"":"s"}</p>
      <p class="description">${escapeHtml(show.description || "No description.")}</p>
      <div class="progress-row" title="${progress.completed} of ${progress.total} seasons completed">
        <div class="progress-track"><div class="progress-fill" style="width:${progress.percent}%"></div></div>
        <span class="progress-text">${progress.completed}/${progress.total} completed</span>
      </div>
      <div class="season-label">SEASON PROGRESS</div>
      <div class="seasons">
        ${(show.seasons||[]).map(s=>`<span class="season-pill ${slug(s.status)}" title="Season ${s.number}: ${escapeAttr(s.status)}">S${s.number}</span>`).join("") || `<span class="muted">No seasons recorded</span>`}
      </div>
      <div class="card-actions">
        <button class="text-btn view-show" type="button">View details</button>
        <button class="text-btn edit-show" type="button">Edit →</button>
      </div>`;
    body.querySelector(".view-show").addEventListener("click",()=>openDetail(show));
    const editButton = body.querySelector(".edit-show");
    editButton.disabled = !showWritesReady();
    editButton.classList.toggle("hidden", !showWritesReady());
    editButton.addEventListener("click",()=>openEditor(show));
    body.querySelector(".card-title").classList.add("clickable-title");
    body.querySelector(".card-title").addEventListener("click",()=>openDetail(show));
    article.append(poster,body);
    return article;
  }

  function openDetail(show){
    if(!show) return;
    const overall = deriveOverallStatus(show);
    const progress = progressFor(show);
    els.detailDialog.dataset.showId = show.id;
    els.detailTitle.textContent = show.title || "Untitled";
    els.detailPlatform.textContent = show.platform || "Unassigned";
    els.detailStatus.textContent = overall;
    els.detailStatus.className = `status-badge ${slug(overall)}`;
    els.detailMeta.textContent = `${formatDate(show.firstAirDate)} · ${progress.total} season${progress.total===1?"":"s"}`;
    els.detailDescription.textContent = show.description || "No description.";
    els.detailProgressText.textContent = `${progress.completed} of ${progress.total} completed`;
    els.detailProgressFill.style.width = `${progress.percent}%`;
    els.detailPoster.innerHTML = `<span>${escapeHtml(initials(show.title))}</span>`;
    setPosterBackground(els.detailPoster, show.posterUrl, show.title);
    els.detailSeasons.innerHTML = (show.seasons || []).map(season => `
      <div class="detail-season ${slug(season.status)}">
        <span class="detail-season-number">Season ${season.number}</span>
        ${cloudAuthority() ? `<div class="detail-season-actions"><select class="cloud-season-control season-cloud-status" data-season-number="${season.number}" aria-label="Season ${season.number} status">${SEASON_STATUSES.map(status=>`<option${status===season.status?" selected":""}>${escapeHtml(status)}</option>`).join("")}</select><button class="text-btn danger-ghost cloud-season-control delete-cloud-season" data-season-number="${season.number}" type="button">Delete</button></div>` : `<span class="detail-season-state">${escapeHtml(season.status)}</span>`}
      </div>`).join("") || `<p class="muted">No seasons recorded.</p>`;
    if(cloudAuthority()) els.detailSeasons.insertAdjacentHTML("beforeend",`<button class="btn detail-add-season cloud-season-control" type="button">Add next season</button>`);
    els.detailSeasons.querySelectorAll(".season-cloud-status").forEach(select=>select.addEventListener("change",()=>changeCloudSeasonStatus(show,Number(select.dataset.seasonNumber),select)));
    els.detailSeasons.querySelectorAll(".delete-cloud-season").forEach(button=>button.addEventListener("click",()=>deleteCloudSeason(show,Number(button.dataset.seasonNumber))));
    els.detailSeasons.querySelector(".detail-add-season")?.addEventListener("click",()=>addCloudSeason(show));
    setMutationControlsDisabled(authority!=="cloud_ready");
    if(!els.detailDialog.open) els.detailDialog.showModal();
  }

  async function addCloudSeason(show){
    if(authority!=="cloud_ready") return;
    const number=(show.seasons.length?Math.max(...show.seasons.map(season=>season.number)):0)+1;
    const season={number,status:"Not Started"};
    const result=await cloudController.mutate({...cloudContext,operation:"createSeason",args:[show,season],submitted:{proposedStatus:season.status,seasonNumber:number}});
    if(!result.ok&&result.outcome!=="conflict"&&authority==="cloud_ready") showCloudFailure();
  }

  async function changeCloudSeasonStatus(show,number,select){
    const season=show.seasons.find(candidate=>candidate.number===number);
    if(!season||authority!=="cloud_ready") return;
    const proposedStatus=select.value; select.value=season.status;
    if(proposedStatus===season.status) return;
    const result=await cloudController.mutate({...cloudContext,operation:"updateSeason",args:[show,{...season,status:proposedStatus}],submitted:{proposedStatus,seasonNumber:number}});
    if(!result.ok&&result.outcome!=="conflict"&&authority==="cloud_ready") showCloudFailure();
  }

  async function deleteCloudSeason(show,number){
    const season=show.seasons.find(candidate=>candidate.number===number);
    if(!season||authority!=="cloud_ready") return;
    const maximum=Math.max(...show.seasons.map(candidate=>candidate.number));
    if(number!==maximum){ alert("Only the final season can be deleted in cloud mode. Middle-season removal and renumbering are not supported yet."); return; }
    if(!confirm(`Delete Season ${number} from your cloud tracker?`)) return;
    const result=await cloudController.mutate({...cloudContext,operation:"deleteSeason",args:[show,season],submitted:{seasonNumber:number}});
    if(!result.ok&&result.outcome!=="conflict"&&authority==="cloud_ready") showCloudFailure();
  }

  function tmdbToken(){
    return String(window.TMDB_CONFIG?.token || "").trim();
  }

  function tmdbImageUrl(path, size="w500"){
    return path ? `https://image.tmdb.org/t/p/${size}${path}` : "";
  }

  async function searchTmdbArtwork(){
    const token = tmdbToken();
    const title = els.titleInput.value.trim();
    const year = (els.dateInput.value || "").slice(0,4);
    if(!token){
      alert("TMDB local token not found. Check config/tmdb.local.js.");
      return;
    }
    if(!title){
      alert("Enter a show title before searching TMDB.");
      return;
    }
    els.findArtworkBtn.disabled = true;
    els.tmdbStatus.textContent = "Searching TMDB…";
    try{
      const params = new URLSearchParams({query:title, include_adult:"false", language:"en-GB", page:"1"});
      if(year) params.set("first_air_date_year", year);
      let response = await fetch(`https://api.themoviedb.org/3/search/tv?${params}`, {
        headers:{Authorization:`Bearer ${token}`, accept:"application/json"}
      });
      if(!response.ok) throw new Error(`TMDB returned ${response.status}`);
      let data = await response.json();
      // If an exact-year search finds nothing, retry title-only rather than presenting no useful candidates.
      if(year && (!Array.isArray(data.results) || data.results.length === 0)){
        params.delete("first_air_date_year");
        response = await fetch(`https://api.themoviedb.org/3/search/tv?${params}`, {
          headers:{Authorization:`Bearer ${token}`, accept:"application/json"}
        });
        if(!response.ok) throw new Error(`TMDB returned ${response.status}`);
        data = await response.json();
      }
      renderTmdbCandidates((data.results || []).slice(0,8), title, year);
      els.tmdbStatus.textContent = `${Math.min((data.results || []).length,8)} candidate${(data.results || []).length===1?"":"s"} returned`;
      els.tmdbDialog.showModal();
    }catch(error){
      console.error(error);
      els.tmdbStatus.textContent = "TMDB search failed";
      alert(`TMDB search failed: ${error.message}`);
    }finally{
      els.findArtworkBtn.disabled = false;
    }
  }

  function renderTmdbCandidates(results, title, year){
    els.tmdbQuerySummary.textContent = year ? `Searching for “${title}” (${year})` : `Searching for “${title}”`;
    els.tmdbResults.innerHTML = "";
    if(!results.length){
      els.tmdbResults.innerHTML = `<p class="muted">No TMDB matches were found. Try adjusting the title or release date.</p>`;
      return;
    }
    results.forEach(result => {
      const candidate = document.createElement("button");
      candidate.type = "button";
      candidate.className = "tmdb-candidate";
      const poster = tmdbImageUrl(result.poster_path, "w185");
      const airYear = String(result.first_air_date || "").slice(0,4) || "Year unknown";
      candidate.innerHTML = `
        <div class="tmdb-thumb">${poster ? `<img src="${escapeAttr(poster)}" alt="">` : `<span>${escapeHtml(initials(result.name))}</span>`}</div>
        <div class="tmdb-candidate-copy">
          <strong>${escapeHtml(result.name || "Untitled")}</strong>
          <span>${escapeHtml(airYear)}</span>
          <p>${escapeHtml(result.overview || "No TMDB synopsis available.")}</p>
        </div>
        <span class="tmdb-select">Use artwork</span>`;
      candidate.addEventListener("click",()=>{
        pendingTmdbMatch = {
          id: result.id,
          name: result.name || "",
          firstAirDate: result.first_air_date || "",
          posterPath: result.poster_path || ""
        };
        els.posterInput.value = tmdbImageUrl(result.poster_path, "w500");
        refreshPosterPreview();
        els.tmdbStatus.textContent = `Selected TMDB #${result.id}${result.poster_path ? " · artwork ready" : " · no poster available"}`;
        els.tmdbDialog.close();
      });
      els.tmdbResults.appendChild(candidate);
    });
  }

  function refreshPosterPreview(){
    els.posterPreview.innerHTML = `<span>${els.posterInput.value.trim() ? "Preview" : initials(els.titleInput.value || "TV")}</span>`;
    setPosterBackground(els.posterPreview, els.posterInput.value, els.titleInput.value || "TV", els.posterInput.value.trim() ? "Preview" : null);
  }

  function openEditor(show=null,draft=null){
    if(!showWritesReady()) return;
    els.showForm.reset();
    els.seasonEditor.innerHTML = "";
    pendingTmdbMatch = null;
    if(els.tmdbStatus) els.tmdbStatus.textContent = tmdbToken() ? "TMDB local token detected." : "Local test only — no API token is stored in Git.";
    if(show){
      const values = draft || show;
      els.dialogTitle.textContent = "Edit Show";
      els.showId.value = show.id;
      els.platformInput.value = values.platform || "";
      els.titleInput.value = values.title || "";
      els.dateInput.value = values.firstAirDate || "";
      els.descriptionInput.value = values.description || "";
      els.posterInput.value = values.posterUrl || "";
      pendingTmdbMatch = values.tmdb ? deepCopy(values.tmdb) : null;
      (show.seasons || []).forEach(s=>addSeasonRow(s.status));
      els.deleteShowBtn.classList.remove("hidden");
    }else{
      els.dialogTitle.textContent = "Add Show";
      els.showId.value = "";
      els.platformInput.value = "";
      addSeasonRow("Not Started");
      els.deleteShowBtn.classList.add("hidden");
    }
    renumberSeasonRows();
    refreshPosterPreview();
    setEditorControls();
    els.showDialog.showModal();
  }

  function addSeasonRow(status="Not Started"){
    const row = els.seasonRowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".season-status").value = SEASON_STATUSES.includes(status) ? status : "Not Started";
    row.querySelector(".remove-season").addEventListener("click",()=>{
      row.remove();
      if(!els.seasonEditor.children.length) addSeasonRow("Not Started");
      renumberSeasonRows();
    });
    els.seasonEditor.appendChild(row);
    renumberSeasonRows();
  }

  function renumberSeasonRows(){ [...els.seasonEditor.children].forEach((row,i)=> row.querySelector(".season-number").textContent = `Season ${i+1}`); }

  function editorRecord(){
    const id = els.showId.value || `tv-${Date.now()}`;
    const now = new Date().toISOString();
    return {
      id,
      platform: els.platformInput.value.trim() || "Unassigned",
      title: els.titleInput.value.trim(),
      firstAirDate: els.dateInput.value,
      description: els.descriptionInput.value.trim(),
      posterUrl: els.posterInput.value.trim(),
      tmdb: pendingTmdbMatch ? deepCopy(pendingTmdbMatch) : null,
      seasons: [...els.seasonEditor.querySelectorAll(".season-status")].map((select,i)=>({number:i+1,status:select.value})),
      createdAt: now,
      updatedAt: now
    };
  }

  async function saveEditor(){
    if(!showWritesReady()) return;
    const record = editorRecord();
    if(authority === "cloud_ready"){
      const current = shows.find(show=>show.id===els.showId.value);
      if(current && !window.TV_TRACKER_CLOUD_MUTATIONS.buildShowPatch(current,record)){ els.showDialog.close(); return; }
      const operation = current ? "updateShow" : "createShow";
      const args = current ? [current,record] : [record];
      const result = await cloudController.mutate({...cloudContext,operation,args,submitted:{draft:record}});
      if(result.ok || result.outcome === "conflict") els.showDialog.close();
      else if(authority === "cloud_ready") showCloudFailure();
      return;
    }
    const id = record.id;
    const index = shows.findIndex(s=>s.id===id);
    if(index>=0){ record.createdAt = shows[index].createdAt || record.createdAt; shows[index]=record; }
    else shows.push(record);
    save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render(); els.showDialog.close();
  }

  async function deleteCurrent(){
    if(!showWritesReady()) return;
    const id = els.showId.value;
    const show = shows.find(s=>s.id===id);
    if(!show) return;
    if(authority === "cloud_ready"){
      if(!confirm(`Delete "${show.title}" from your cloud tracker?`)) return;
      const result=await cloudController.mutate({...cloudContext,operation:"deleteShow",args:[show],submitted:{showId:show.id,title:show.title}});
      if(result.ok || result.outcome === "conflict") els.showDialog.close();
      else if(authority === "cloud_ready") showCloudFailure();
    }else if(confirm(`Delete "${show.title}" from this device?`)){
      shows = shows.filter(s=>s.id!==id);
      save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render(); els.showDialog.close();
    }
  }

  function downloadJson(payload,filename){
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function exportLocalBackup(){
    const result = localRepository.readTracker({baseline:baselineShows});
    const payload = {schemaVersion:1, exportedAt:new Date().toISOString(), shows:result.data.shows};
    downloadJson(payload,`tv-series-tracker-local-backup-${new Date().toISOString().slice(0,10)}.json`);
  }

  async function exportCloudTracker(){
    if(!["cloud_ready","cloud_conflict"].includes(authority)) return;
    try{
      const prepared=await window.TV_TRACKER_CLOUD_EXPORT.prepareCloudExport(deepCopy(shows));
      downloadJson(prepared.payload,window.TV_TRACKER_CLOUD_EXPORT.safeFilename(prepared.payload.exportedAt));
    }catch{
      showCloudFailure();
    }
  }

  async function importJson(file){
    if(!file || authority !== "local") return;
    try{
      const payload = JSON.parse(await file.text());
      const imported = Array.isArray(payload) ? payload : payload.shows;
      if(!Array.isArray(imported)) throw new Error("JSON does not contain a shows array.");
      if(authority !== "local" || !confirm(`Replace this device's current ${shows.length} shows with ${imported.length} imported shows?`)) return;
      shows = deepCopy(imported);
      save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render();
    }catch(err){ alert(`Import failed: ${err.message}`); }
    finally{ els.importFile.value=""; }
  }

  function resetBaseline(){
    if(authority !== "local") return;
    if(!confirm(`Restore the original ${baselineShows.length}-show baseline on this device? Local edits will be replaced.`)) return;
    shows = deepCopy(baselineShows);
    save(); refreshPlatformOptions(); clearFilters(); render();
  }

  function setStatusFilter(status){
    els.statusFilter.value = status;
    visibleLimit = PAGE_SIZE;
    render();
  }

  function clearFilters(){
    els.searchInput.value = "";
    els.platformFilter.value = "";
    els.statusFilter.value = "";
    visibleLimit = PAGE_SIZE;
    render();
  }

  function setView(mode){
    const compact = mode === "compact";
    document.body.classList.toggle("compact-view", compact);
    els.cardsViewBtn.classList.toggle("active", !compact);
    els.compactViewBtn.classList.toggle("active", compact);
    els.cardsViewBtn.setAttribute("aria-pressed", String(!compact));
    els.compactViewBtn.setAttribute("aria-pressed", String(compact));
    localStorage.setItem(VIEW_KEY, compact ? "compact" : "cards");
  }

  function applySavedView(){ setView(localStorage.getItem(VIEW_KEY) === "compact" ? "compact" : "cards"); }

  function escapeHtml(value){ return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
  function escapeAttr(value){ return escapeHtml(value); }

  els.addShowBtn.addEventListener("click",()=>openEditor());
  els.addSeasonBtn.addEventListener("click",()=>addSeasonRow("Not Started"));
  els.findArtworkBtn?.addEventListener("click", searchTmdbArtwork);
  els.closeTmdbBtn?.addEventListener("click",()=>els.tmdbDialog.close());
  els.showForm.addEventListener("submit",e=>{e.preventDefault();saveEditor();});
  els.deleteShowBtn.addEventListener("click",deleteCurrent);
  els.exportBtn.addEventListener("click",exportLocalBackup);
  els.cloudExportBtn?.addEventListener("click",exportCloudTracker);
  els.importFile.addEventListener("change",e=>importJson(e.target.files[0]));
  els.resetBtn.addEventListener("click",resetBaseline);
  els.clearFiltersBtn.addEventListener("click",clearFilters);
  els.cardsViewBtn.addEventListener("click",()=>setView("cards"));
  els.compactViewBtn.addEventListener("click",()=>setView("compact"));
  els.loadMoreBtn.addEventListener("click",()=>{visibleLimit += PAGE_SIZE; render();});
  statButtons.forEach(btn=>btn.addEventListener("click",()=>setStatusFilter(btn.dataset.statStatus)));
  statusChips.forEach(btn=>btn.addEventListener("click",()=>setStatusFilter(btn.dataset.statusChip)));
  els.searchInput.addEventListener("input",()=>{visibleLimit=PAGE_SIZE;render();});
  [els.platformFilter,els.statusFilter,els.sortSelect].forEach(el=>el.addEventListener("change",()=>{visibleLimit=PAGE_SIZE;render();}));
  els.posterInput.addEventListener("input",refreshPosterPreview);
  els.titleInput.addEventListener("input",refreshPosterPreview);
  els.closeDetailBtn.addEventListener("click",()=>els.detailDialog.close());
  els.detailEditBtn.addEventListener("click",()=>{
    const show = shows.find(s=>s.id===els.detailDialog.dataset.showId);
    els.detailDialog.close();
    if(show) openEditor(show);
  });
  els.cloudSyncRetryBtn?.addEventListener("click",async()=>{ if(cloudController&&cloudContext) await cloudController.recover(cloudContext); });
  conflictReview = window.TV_TRACKER_SHOW_CONFLICT_REVIEW.createConflictReview({document,
    onUseCurrent:()=>cloudController?.clearConflict(),
    onReview:model=>{
      const current=model.current;
      if(!current){ cloudController?.clearConflict(); return; }
      cloudController?.clearConflict();
      openEditor(current,model.kind==="update"?model.proposed:null);
    },
    onCancel:()=>{}
  });
  seasonConflictReview = window.TV_TRACKER_SEASON_CONFLICT_REVIEW.createSeasonConflictReview({document,
    onUseCurrent:()=>cloudController?.clearConflict(),
    onReview:model=>{
      cloudController?.clearConflict();
      if(model.kind==="update"&&model.currentStatus===model.proposedStatus){ seasonConflictReview.close(); return; }
      if(model.kind==="delete"&&!model.isFinal){ seasonConflictReview.close(); return; }
      seasonConflictReview.confirmRetry(model);
    },
    onRetry:async model=>{
      if(authority!=="cloud_ready"||!model.parent||!model.current) return;
      if(model.kind==="update") await cloudController.mutate({...cloudContext,operation:"updateSeason",args:[model.parent,{...model.current,status:model.proposedStatus}],submitted:{proposedStatus:model.proposedStatus,seasonNumber:model.current.number}});
      else if(model.kind==="delete") await deleteCloudSeason(model.parent,model.current.number);
    },
    onCancel:()=>{}
  });
  els.cloudConflictDiscardBtn?.addEventListener("click",()=>{ const state=cloudController?.getState(); if(state?.conflict){ conflictReview.show(state.conflict); seasonConflictReview.show(state.conflict); } });
  els.detailDialog.addEventListener("click",e=>{
    const rect = els.detailDialog.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if(!inside) els.detailDialog.close();
  });

  try{ load(); }
  catch(err){
    console.error(err);
    els.cardsContainer.innerHTML = `<div class="empty-state"><h2>Unable to load catalogue</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
  window.TV_TRACKER_APP = Object.freeze({applyCloudSyncState,exportLocalBackup,getAuthority:()=>authority,returnToLocal,setCloudWritable});
})();
