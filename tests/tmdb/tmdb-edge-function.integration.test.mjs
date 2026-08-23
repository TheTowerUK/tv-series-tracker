import test from "node:test";
import assert from "node:assert/strict";

const functionUrl = process.env.TV_TRACKER_TEST_FUNCTION_URL;
const publishableKey = process.env.TV_TRACKER_TEST_PUBLISHABLE_KEY;
const accessToken = process.env.TV_TRACKER_TEST_ACCESS_TOKEN;
const enabled = Boolean(functionUrl && publishableKey);

test("local Edge gateway denies anonymous invocation", { skip: !enabled }, async () => {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "1.0.0", query: "Doctor Who" })
  });
  assert.equal(response.status, 401);
});

test("local authenticated invocation reaches strict function validation", { skip: !(enabled && accessToken) }, async () => {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "1.0.0", query: "" })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.contractVersion, "1.0.0");
  assert.equal(body.error.code, "invalid_request");
  assert.equal(body.error.fields[0].path, "/query");
});
