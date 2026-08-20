"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const vendoredClient = path.join(repositoryRoot, "vendor/supabase-js/2.112.3/supabase.js");

test("vendored Supabase client matches the reviewed 2.112.3 artifact", () => {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(vendoredClient)).digest("hex");
  assert.equal(digest, "10e9e53b8072b680dba9be76a58063b7fabd9f888552d7579465c6027296f42a");
  assert.match(fs.readFileSync(vendoredClient, "utf8"), /supabase-js\/2\.112\.3/);
});

test("static scripts load vendor, local configuration and bootstrap before the existing app", () => {
  const html = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
  const orderedScripts = [
    "vendor/supabase-js/2.112.3/supabase.js",
    "config/supabase.local.js",
    "js/supabase-bootstrap.js",
    "js/app.js"
  ];
  const positions = orderedScripts.map((script) => html.indexOf(`src="${script}"`));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});
