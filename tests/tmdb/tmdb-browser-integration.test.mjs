import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("browser loads the TMDB service after Supabase bootstrap and before app", () => {
  const html = read("index.html");
  const bootstrap = html.indexOf('src="js/supabase-bootstrap.js"');
  const service = html.indexOf('src="js/tmdb-search-service.js"');
  const app = html.indexOf('src="js/app.js"');
  assert.ok(bootstrap >= 0 && bootstrap < service && service < app);
  assert.doesNotMatch(html, /config\/tmdb\.local\.js|config\/tmdb\.example\.js/);
});

test("committed browser code has no TMDB token or direct API dependency", () => {
  const browser = ["index.html", ...fs.readdirSync(path.join(root, "js")).map((name) => `js/${name}`)]
    .map(read).join("\n");
  assert.doesNotMatch(browser, /TMDB_CONFIG|tmdbToken\s*\(|api\.themoviedb\.org|TMDB_API_READ_ACCESS_TOKEN/);
  assert.match(read("js/tmdb-search-service.js"), /functions\.invoke\(FUNCTION_NAME/);
});

test("editor keeps manual poster and normalized candidate selection for local and cloud save paths", () => {
  const app = read("js/app.js");
  const html = read("index.html");
  assert.match(html, /id="posterInput" type="url"/);
  assert.match(app, /posterUrl: els\.posterInput\.value\.trim\(\)/);
  assert.match(app, /pendingTmdbMatch = \{\s*id: result\.id,\s*name: result\.name \|\| "",\s*firstAirDate: result\.firstAirDate \|\| "",\s*posterPath: result\.posterPath \|\| ""/s);
  assert.match(app, /operation = current \? "updateShow" : "createShow"/);
  assert.match(app, /if\(index>=0\).*shows\[index\]=record.*else shows\.push\(record\).*save\(\)/s);
});

test("signed-out artwork search is unavailable without starting Auth and tracker remains usable", () => {
  const app = read("js/app.js");
  assert.match(app, /authState\?\.status !== "authenticated"/);
  assert.match(app, /Sign in to search TMDB\. Manual poster URLs remain available\./);
  const searchBlock = app.slice(app.indexOf("async function searchTmdbArtwork"), app.indexOf("function renderTmdbCandidates"));
  assert.doesNotMatch(searchBlock, /requestPasswordlessSignIn|verifyEmailOtp|signInWithOtp/);
  assert.match(app, /const localRepository = .*createLocalTrackerRepository/);
});

test("Edge Function remains the only owner of upstream search behavior and has no tracker access", () => {
  const handler = read("supabase/functions/tmdb-search-tv/handler.mjs");
  assert.match(handler, /https:\/\/api\.themoviedb\.org\/3\/search\/tv/);
  assert.doesNotMatch(handler, /\.from\s*\(|\.rpc\s*\(|shows|season_progress|migration_receipts|service[_-]?role/i);
});
