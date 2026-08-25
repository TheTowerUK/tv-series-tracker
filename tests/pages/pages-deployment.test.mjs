import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  buildPagesArtifact,
  staticEntries,
  validatePublicConfiguration
} from "../../scripts/build-pages-artifact.mjs";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = join(root, ".github", "workflows", "deploy-pages.yml");
const publicUrl = "https://rdebzeuibpxpjngzqgaj.supabase.co";
const publicKey = "sb_publishable_pages_test_value_1234567890";

async function walk(directory, prefix = "") {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...await walk(join(directory, entry.name), name));
    else names.push(name);
  }
  return names.sort();
}

async function withArtifact(callback) {
  const systemTemp = tmpdir();
  const parentBase = resolve(systemTemp) === root ? join(root, "node_modules") : systemTemp;
  const parent = await mkdtemp(join(parentBase, "tv-series-tracker-pages-"));
  const output = join(parent, "artifact");
  try {
    await buildPagesArtifact({ output, url: publicUrl, publishableKey: publicKey });
    await callback(output);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test("workflow uses only the two approved browser-public variables and minimum Pages permissions", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const variableReferences = [...workflow.matchAll(/vars\.([A-Z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(variableReferences)].sort(), ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_URL"]);
  assert.doesNotMatch(workflow, /\bsecrets\./);
  assert.doesNotMatch(workflow, /service.?role|database.?password|jwt.?secret|supabase.?access.?token|tmdb/i);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /name:\s*github-pages/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test("artifact builder uses a static allow-list and excludes local, secret, and development state", async () => {
  assert.deepEqual(staticEntries, ["index.html", "css", "data", "js", "vendor/supabase-js"]);
  await withArtifact(async (output) => {
    const files = await walk(output);
    for (const forbidden of ["tests/", "docs/", "supabase/", "node_modules/", ".git/", ".env", "config/supabase.example.js"] ) {
      assert.equal(files.some((file) => file === forbidden || file.startsWith(forbidden)), false, forbidden);
    }
    assert.equal(files.includes("config/supabase.local.js"), true);
    assert.equal(files.includes(".nojekyll"), true);
  });
});

test("generated browser configuration has the exact approved shape", async () => {
  await withArtifact(async (output) => {
    const source = await readFile(join(output, "config", "supabase.local.js"), "utf8");
    const sandbox = { window: {} };
    vm.runInNewContext(source, sandbox);
    assert.deepEqual(Object.keys(sandbox.window.SUPABASE_CONFIG).sort(), ["publishableKey", "url"]);
    assert.equal(sandbox.window.SUPABASE_CONFIG.url, `${publicUrl}/`);
    assert.equal(sandbox.window.SUPABASE_CONFIG.publishableKey, publicKey);
    assert.equal(Object.isFrozen(sandbox.window.SUPABASE_CONFIG), true);
    assert.doesNotMatch(source, /TMDB|service[_-]?role|database password|JWT|access token/i);
  });
});

test("privileged or malformed configuration cannot enter the artifact", () => {
  assert.throws(() => validatePublicConfiguration(publicUrl, "sb_secret_forbidden_value_1234567890"), /forbidden/i);
  assert.throws(() => validatePublicConfiguration(publicUrl, "service_role_forbidden_value_1234567890"), /forbidden/i);
  assert.throws(() => validatePublicConfiguration("http://example.com", publicKey), /HTTPS origin/i);
});

test("artifact preserves script order and the canonical repository Pages path", async () => {
  await withArtifact(async (output) => {
    const html = await readFile(join(output, "index.html"), "utf8");
    const vendor = html.indexOf("vendor/supabase-js/2.112.3/supabase.js");
    const config = html.indexOf("config/supabase.local.js");
    const bootstrap = html.indexOf("js/supabase-bootstrap.js");
    const app = html.indexOf("js/app.js");
    assert.ok(vendor >= 0 && vendor < config && config < bootstrap && bootstrap < app);
    assert.doesNotMatch(html, /TMDB_CONFIG|tmdb\.local\.js|api\.themoviedb\.org/);

    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const reference = match[1];
      if (/^(?:https?:|#|data:)/.test(reference)) continue;
      const deployed = new URL(reference, "https://thetoweruk.github.io/tv-series-tracker/");
      assert.ok(deployed.pathname.startsWith("/tv-series-tracker/"), reference);
      await readFile(join(output, reference), "utf8");
    }
  });
});
