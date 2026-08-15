(() => {
  "use strict";

  const STORAGE_KEY = "tvSeriesTrackerData.v1";
  const VIEW_KEY = "tvSeriesTrackerView.v1";
  const PAGE_SIZE = 60;
  const SEASON_STATUSES = ["Not Started","Watching","Completed","Purchase Only","Region Blocked"];
  const CANONICAL_PLATFORMS = ["Netflix","Prime Video","BBC iPlayer","Disney+","NOW","TV"];

  let baselineShows = [];
  let shows = [];
  let visibleLimit = PAGE_SIZE;

  const $ = (id) => document.getElementById(id);
  const els = {
    addShowBtn: $("addShowBtn"), exportBtn: $("exportBtn"), importFile: $("importFile"), resetBtn: $("resetBtn"),
    searchInput: $("searchInput"), platformFilter: $("platformFilter"), statusFilter: $("statusFilter"), sortSelect: $("sortSelect"),
    cardsViewBtn: $("cardsViewBtn"), compactViewBtn: $("compactViewBtn"), clearFiltersBtn: $("clearFiltersBtn"),
    cardsContainer: $("cardsContainer"), emptyState: $("emptyState"), resultCount: $("resultCount"),
    loadMoreWrap: $("loadMoreWrap"), loadMoreBtn: $("loadMoreBtn"),
    statTotal: $("statTotal"), statWatching: $("statWatching"), statCompleted: $("statCompleted"),
    statNotStarted: $("statNotStarted"), statPartial: $("statPartial"), statUnavailable: $("statUnavailable"),
    showDialog: $("showDialog"), showForm: $("showForm"), dialogTitle: $("dialogTitle"), showId: $("showId"),
    platformInput: $("platformInput"), platformOptions: $("platformOptions"), titleInput: $("titleInput"),
    dateInput: $("dateInput"), descriptionInput: $("descriptionInput"), posterInput: $("posterInput"),
    seasonEditor: $("seasonEditor"), addSeasonBtn: $("addSeasonBtn"), deleteShowBtn: $("deleteShowBtn"),
    seasonRowTemplate: $("seasonRowTemplate"), posterPreview: $("posterPreview"),
    detailDialog: $("detailDialog"), closeDetailBtn: $("closeDetailBtn"), detailPoster: $("detailPoster"),
    detailTitle: $("detailTitle"), detailPlatform: $("detailPlatform"), detailStatus: $("detailStatus"),
    detailMeta: $("detailMeta"), detailDescription: $("detailDescription"), detailProgressText: $("detailProgressText"),
    detailProgressFill: $("detailProgressFill"), detailSeasons: $("detailSeasons"), detailEditBtn: $("detailEditBtn")
  };

  const statButtons = [...document.querySelectorAll("[data-stat-status]")];
  const statusChips = [...document.querySelectorAll("[data-status-chip]")];

  function deepCopy(value){ return JSON.parse(JSON.stringify(value)); }
  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify({schemaVersion:1, shows})); }

  function load(){
    const baseline = window.TV_TRACKER_BASELINE;
    if(!baseline) throw new Error("Unable to load baseline catalogue.");
    baselineShows = deepCopy(Array.isArray(baseline) ? baseline : baseline.shows || []);
    try{
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      shows = stored ? deepCopy(Array.isArray(stored) ? stored : stored.shows || []) : deepCopy(baselineShows);
    }catch{
      shows = deepCopy(baselineShows);
    }
    refreshPlatformOptions();
    applySavedView();
    render();
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
    body.querySelector(".edit-show").addEventListener("click",()=>openEditor(show));
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
        <span class="detail-season-state">${escapeHtml(season.status)}</span>
      </div>`).join("") || `<p class="muted">No seasons recorded.</p>`;
    els.detailDialog.showModal();
  }

  function refreshPosterPreview(){
    els.posterPreview.innerHTML = `<span>${els.posterInput.value.trim() ? "Preview" : initials(els.titleInput.value || "TV")}</span>`;
    setPosterBackground(els.posterPreview, els.posterInput.value, els.titleInput.value || "TV", els.posterInput.value.trim() ? "Preview" : null);
  }

  function openEditor(show=null){
    els.showForm.reset();
    els.seasonEditor.innerHTML = "";
    if(show){
      els.dialogTitle.textContent = "Edit Show";
      els.showId.value = show.id;
      els.platformInput.value = show.platform || "";
      els.titleInput.value = show.title || "";
      els.dateInput.value = show.firstAirDate || "";
      els.descriptionInput.value = show.description || "";
      els.posterInput.value = show.posterUrl || "";
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

  function saveEditor(){
    const id = els.showId.value || `tv-${Date.now()}`;
    const now = new Date().toISOString();
    const record = {
      id,
      platform: els.platformInput.value.trim() || "Unassigned",
      title: els.titleInput.value.trim(),
      firstAirDate: els.dateInput.value,
      description: els.descriptionInput.value.trim(),
      posterUrl: els.posterInput.value.trim(),
      seasons: [...els.seasonEditor.querySelectorAll(".season-status")].map((select,i)=>({number:i+1,status:select.value})),
      createdAt: now,
      updatedAt: now
    };
    const index = shows.findIndex(s=>s.id===id);
    if(index>=0){ record.createdAt = shows[index].createdAt || record.createdAt; shows[index]=record; }
    else shows.push(record);
    save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render(); els.showDialog.close();
  }

  function deleteCurrent(){
    const id = els.showId.value;
    const show = shows.find(s=>s.id===id);
    if(!show) return;
    if(confirm(`Delete "${show.title}" from this device?`)){
      shows = shows.filter(s=>s.id!==id);
      save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render(); els.showDialog.close();
    }
  }

  function exportJson(){
    const payload = {schemaVersion:1, exportedAt:new Date().toISOString(), shows};
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`tv-series-tracker-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function importJson(file){
    if(!file) return;
    try{
      const payload = JSON.parse(await file.text());
      const imported = Array.isArray(payload) ? payload : payload.shows;
      if(!Array.isArray(imported)) throw new Error("JSON does not contain a shows array.");
      if(!confirm(`Replace this device's current ${shows.length} shows with ${imported.length} imported shows?`)) return;
      shows = deepCopy(imported);
      save(); refreshPlatformOptions(); visibleLimit = PAGE_SIZE; render();
    }catch(err){ alert(`Import failed: ${err.message}`); }
    finally{ els.importFile.value=""; }
  }

  function resetBaseline(){
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
  els.showForm.addEventListener("submit",e=>{e.preventDefault();saveEditor();});
  els.deleteShowBtn.addEventListener("click",deleteCurrent);
  els.exportBtn.addEventListener("click",exportJson);
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
})();
