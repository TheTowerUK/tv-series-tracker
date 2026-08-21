"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PREFIX, createKeepCloudMarkerStore } = require("../../js/migration-marker.js");
function storage() { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }

test("keep marker is account-scoped without storing raw account identity", async () => {
  const target = storage();
  const store = createKeepCloudMarkerStore({ storage: target, sha256Hex: async value => `derived-${value.length}` });
  await store.write("private-owner-uuid", "source-a");
  const [[key, value]] = target.values;
  assert.equal(key, PREFIX + "derived-18");
  assert.doesNotMatch(key + value, /private-owner-uuid|email|token/i);
  assert.equal(await store.read("private-owner-uuid", "source-a"), true);
});

test("changed source invalidates and removes dismissal", async () => {
  const target = storage();
  const store = createKeepCloudMarkerStore({ storage: target, sha256Hex: async () => "owner-hash" });
  await store.write("owner", "old-source");
  assert.equal(await store.read("owner", "new-source"), false);
  assert.equal(target.values.size, 0);
});
