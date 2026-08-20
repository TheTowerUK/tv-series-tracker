"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");

test("account UI exposes the required signed-out, verification and signed-in controls", () => {
  const html = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
  for (const id of [
    "accountPanel", "authRequestForm", "authEmail", "authSendBtn", "authVerification",
    "authVerificationForm", "authOtp", "authVerifyBtn", "authResendBtn", "authSignedIn",
    "authSignOutBtn", "authStatus"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-live="polite"/);
});

test("Auth modules load after the singleton bootstrap and before the tracker app", () => {
  const html = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
  const scripts = ["js/supabase-bootstrap.js", "js/auth-session.js", "js/auth-ui.js", "js/app.js"];
  const positions = scripts.map((script) => html.indexOf(`src="${script}"`));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});

test("Auth UI contains no cloud tracker or migration calls", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "js/auth-ui.js"), "utf8");
  assert.doesNotMatch(source, /\.from\s*\(|\.rpc\s*\(|tracker_migrate_v1|tracker_restore_v2/);
});
