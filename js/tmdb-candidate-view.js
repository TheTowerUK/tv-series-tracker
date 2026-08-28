(function tmdbCandidateViewModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_TMDB_CANDIDATE_VIEW = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  function imageUrl(path, size = "w185") {
    return typeof path === "string" && path.startsWith("/") ? `https://image.tmdb.org/t/p/${size}${path}` : "";
  }

  function initials(value) {
    return String(value || "TV").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function candidateElement({ document, candidate, onSelect = null, label = "Use artwork", selected = false } = {}) {
    if (!document || !candidate) throw new TypeError("Document and candidate are required");
    const interactive = typeof onSelect === "function";
    const element = document.createElement(interactive ? "button" : "article");
    if (interactive) element.type = "button";
    element.className = `tmdb-candidate${selected ? " selected" : ""}`;
    if (interactive) element.setAttribute("aria-pressed", String(selected));

    const thumb = document.createElement("div");
    thumb.className = "tmdb-thumb";
    const poster = imageUrl(candidate.posterPath);
    if (poster) {
      const image = document.createElement("img");
      image.src = poster;
      image.alt = "";
      thumb.appendChild(image);
    } else {
      const fallback = document.createElement("span");
      fallback.textContent = initials(candidate.name);
      thumb.appendChild(fallback);
    }

    const copy = document.createElement("div");
    copy.className = "tmdb-candidate-copy";
    const name = document.createElement("strong");
    name.textContent = candidate.name || "Untitled";
    const year = document.createElement("span");
    year.textContent = String(candidate.firstAirDate || "").slice(0, 4) || "Year unknown";
    const overview = document.createElement("p");
    overview.textContent = candidate.overview || "No TMDB synopsis available.";
    copy.append(name, year, overview);

    const action = document.createElement("span");
    action.className = "tmdb-select";
    action.textContent = label;
    element.append(thumb, copy, action);
    if (interactive) element.addEventListener("click", () => onSelect(candidate));
    return element;
  }

  return Object.freeze({ candidateElement, imageUrl });
});
