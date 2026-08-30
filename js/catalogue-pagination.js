(function cataloguePaginationModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_CATALOGUE_PAGINATION = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const PAGE_SIZE = 60;

  function pageCount(itemCount, pageSize = PAGE_SIZE) {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0;
    return Math.max(1, Math.ceil(count / pageSize));
  }

  function clampPage(page, itemCount, pageSize = PAGE_SIZE) {
    const requested = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
    return Math.min(requested, pageCount(itemCount, pageSize));
  }

  function paginate(items, page, pageSize = PAGE_SIZE) {
    if (!Array.isArray(items)) throw new TypeError("Catalogue items must be an array.");
    const currentPage = clampPage(page, items.length, pageSize);
    const totalPages = pageCount(items.length, pageSize);
    const start = (currentPage - 1) * pageSize;
    return Object.freeze({
      currentPage,
      totalPages,
      items: Object.freeze(items.slice(start, start + pageSize)),
      hasPrevious: currentPage > 1,
      hasNext: currentPage < totalPages
    });
  }

  return Object.freeze({ PAGE_SIZE, clampPage, pageCount, paginate });
});
