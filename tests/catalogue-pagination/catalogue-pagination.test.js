"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PAGE_SIZE, clampPage, pageCount, paginate } = require("../../js/catalogue-pagination.js");

const read = file => fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
const catalogue = count => Array.from({ length: count }, (_, index) => Object.freeze({ id: `show-${index + 1}` }));

test("catalogue pages are bounded to 60 with a final partial page", () => {
  assert.equal(PAGE_SIZE, 60);
  assert.equal(pageCount(352), 6);
  assert.equal(paginate(catalogue(352), 1).items.length, 60);
  const last = paginate(catalogue(352), 6);
  assert.equal(last.items.length, 52);
  assert.equal(last.hasNext, false);
  assert.equal(last.hasPrevious, true);
});

test("previous and next page boundaries are deterministic", () => {
  const items = catalogue(121);
  assert.deepEqual(paginate(items, 1).items.map(item => item.id).slice(0, 2), ["show-1", "show-2"]);
  assert.equal(paginate(items, 2).items[0].id, "show-61");
  assert.equal(paginate(items, 3).items[0].id, "show-121");
  assert.equal(clampPage(99, items.length), 3);
  assert.equal(clampPage(0, items.length), 1);
});

test("pagination never mutates tracker order or records", () => {
  const items = catalogue(80);
  const before = JSON.stringify(items);
  const page = paginate(items, 2);
  assert.equal(JSON.stringify(items), before);
  assert.equal(page.items.length, 20);
  assert.throws(() => page.items.push({ id: "write" }), TypeError);
});

test("empty and reduced results clamp to a valid page", () => {
  assert.equal(pageCount(0), 1);
  assert.equal(paginate([], 8).currentPage, 1);
  assert.equal(paginate(catalogue(59), 6).currentPage, 1);
  assert.equal(paginate(catalogue(61), 6).currentPage, 2);
});

test("main catalogue uses accessible bounded navigation with no cumulative loading", () => {
  const html = read("index.html");
  const app = read("js/app.js");
  assert.match(html, /aria-label="Catalogue pages"/);
  assert.match(html, /aria-label="Previous catalogue page"/);
  assert.match(html, /aria-label="Next catalogue page"/);
  assert.match(app, /pagination\.paginate\(list,currentPage,PAGE_SIZE\)/);
  assert.match(app, /currentPage=1;render\(\)/);
  assert.doesNotMatch(`${html}\n${app}`, /Load more|visibleLimit|loadMoreBtn|loadMoreWrap/);
});

test("cloud rereads preserve page and filter/sort changes intentionally reset page one", () => {
  const app = read("js/app.js");
  const syncBranch = app.slice(app.indexOf("function applyCloudSyncState"), app.indexOf("function showCloudFailure"));
  assert.doesNotMatch(syncBranch, /currentPage\s*=\s*1/);
  assert.match(app, /searchInput\.addEventListener\("input",\(\)=>\{currentPage=1;render\(\);\}\)/);
  assert.match(app, /platformFilter,els\.statusFilter,els\.sortSelect[\s\S]*currentPage=1;render\(\)/);
});

test("ordinary rereads preserve an open draft and deleted active records close explicitly", () => {
  const app = read("js/app.js");
  const syncBranch = app.slice(app.indexOf("function applyCloudSyncState"), app.indexOf("function showCloudFailure"));
  assert.match(syncBranch, /editedId = els\.showDialog\.open \? els\.showId\.value/);
  assert.match(syncBranch, /editedId && !shows\.some\(show=>show\.id===editedId\)/);
  assert.match(syncBranch, /Your unsaved changes were not applied/);
  assert.doesNotMatch(syncBranch, /openEditor\(/);
});

test("same-account activation preserves editor while genuine cloud exit clears private dialogs", () => {
  const app = read("js/app.js");
  const activate = app.slice(app.indexOf("function setCloudWritable"), app.indexOf("function returnToLocal"));
  const leave = app.slice(app.indexOf("function returnToLocal"), app.indexOf("function slug"));
  assert.match(activate, /sameCloudAccount/);
  assert.match(activate, /if\(!sameCloudAccount\).*showDialog/s);
  assert.match(leave, /leavingCloud/);
  assert.match(leave, /if\(leavingCloud\).*showDialog/s);
});

test("device writes remain local and pagination has no repository dependency", () => {
  const app = read("js/app.js");
  const paginationSource = read("js/catalogue-pagination.js");
  assert.match(app, /if\(authority !== "local"\) throw new Error/);
  assert.doesNotMatch(paginationSource, /localStorage|sessionStorage|repository|\.rpc\s*\(|fetch\s*\(/);
});
