"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OUTCOMES,
  STATES,
  createAuthSession,
  normalizeAuthError
} = require("../../js/auth-session.js");

function session(id) {
  return { access_token: "not-observed", refresh_token: "not-observed", user: { id, email: "not-retained@example.test" } };
}

function fakeClient({ initialSession = null, sessionError = null } = {}) {
  const calls = [];
  let listener = null;
  let nextSession = initialSession;
  let nextSessionError = sessionError;
  let otpResult = { data: { session: null }, error: null };
  let verifyResult = { data: { session: null }, error: null };
  let signOutResult = { error: null };

  return {
    calls,
    emit(event, value) { listener(event, value); },
    setSessionResult(value, error = null) { nextSession = value; nextSessionError = error; },
    setOtpResult(value) { otpResult = value; },
    setVerifyResult(value) { verifyResult = value; },
    setSignOutResult(value) { signOutResult = value; },
    auth: {
      onAuthStateChange(callback) {
        calls.push(["listener"]);
        listener = callback;
        return { data: { subscription: { unsubscribe() { calls.push(["unsubscribe"]); } } } };
      },
      async getSession() {
        calls.push(["getSession"]);
        return { data: { session: nextSession }, error: nextSessionError };
      },
      async signInWithOtp(request) {
        calls.push(["signInWithOtp", request]);
        return otpResult;
      },
      async verifyOtp(request) {
        calls.push(["verifyOtp", request]);
        return verifyResult;
      },
      async signOut(options) {
        calls.push(["signOut", options]);
        return signOutResult;
      }
    }
  };
}

test("subscribes before restoring an authenticated session", async () => {
  const client = fakeClient({ initialSession: session("account-a") });
  const states = [];
  const auth = createAuthSession({ client, onStateChange: (value) => states.push(value) });
  const result = await auth.start();

  assert.deepEqual(client.calls.slice(0, 2).map(([name]) => name), ["listener", "getSession"]);
  assert.equal(result.status, STATES.AUTHENTICATED);
  assert.equal(result.accountId, "account-a");
  assert.equal(states.at(-1).reason, "session_restored");
});

test("restores the stable signed-out state", async () => {
  const auth = createAuthSession({ client: fakeClient() });
  assert.equal((await auth.start()).status, STATES.SIGNED_OUT);
  assert.equal(auth.getState().accountId, null);
});

test("passwordless initiation is controlled and retains no email", async () => {
  const client = fakeClient();
  const auth = createAuthSession({ client, redirectUrl: "http://127.0.0.1:3000/" });
  await auth.start();
  const result = await auth.requestPasswordlessSignIn("  viewer@example.test ");

  assert.equal(result.status, STATES.AWAITING_VERIFICATION);
  assert.deepEqual(client.calls.find(([name]) => name === "signInWithOtp")[1], {
    email: "viewer@example.test",
    options: { shouldCreateUser: false, emailRedirectTo: "http://127.0.0.1:3000/" }
  });
  assert.equal(JSON.stringify(auth.getState()).includes("viewer@example.test"), false);
});

test("invalid email is rejected before calling Supabase", async () => {
  const client = fakeClient();
  const auth = createAuthSession({ client });
  await auth.start();
  const result = await auth.requestPasswordlessSignIn("not-an-email");
  assert.equal(result.outcome, OUTCOMES.INVALID_EMAIL);
  assert.equal(client.calls.some(([name]) => name === "signInWithOtp"), false);
});

test("OTP verification authenticates without exposing tokens or email", async () => {
  const client = fakeClient();
  client.setVerifyResult({ data: { session: session("account-a") }, error: null });
  const auth = createAuthSession({ client });
  await auth.start();
  const result = await auth.verifyEmailOtp("viewer@example.test", "123456");

  assert.equal(result.status, STATES.AUTHENTICATED);
  assert.equal(result.accountId, "account-a");
  assert.deepEqual(client.calls.find(([name]) => name === "verifyOtp")[1], {
    email: "viewer@example.test",
    token: "123456",
    type: "email"
  });
  assert.equal(JSON.stringify(result).includes("not-observed"), false);
  assert.equal(JSON.stringify(result).includes("viewer@example.test"), false);
});

test("sign-out clears account state and is local to this browser", async () => {
  const client = fakeClient({ initialSession: session("account-a") });
  const auth = createAuthSession({ client });
  await auth.start();
  const result = await auth.signOut();
  assert.equal(result.status, STATES.SIGNED_OUT);
  assert.equal(result.accountId, null);
  assert.deepEqual(client.calls.find(([name]) => name === "signOut")[1], { scope: "local" });
});

test("listener detects account changes and token refresh", async () => {
  const client = fakeClient({ initialSession: session("account-a") });
  const auth = createAuthSession({ client });
  await auth.start();
  client.emit("SIGNED_IN", session("account-b"));
  assert.equal(auth.getState().reason, "account_changed");
  assert.equal(auth.getState().accountId, "account-b");
  client.emit("TOKEN_REFRESHED", session("account-b"));
  assert.equal(auth.getState().reason, "token_refreshed");
});

test("unexpected sign-out becomes session expired and recovery is non-destructive", async () => {
  const client = fakeClient({ initialSession: session("account-a") });
  const auth = createAuthSession({ client });
  await auth.start();
  client.emit("SIGNED_OUT", null);
  assert.equal(auth.getState().status, STATES.SESSION_EXPIRED);
  assert.equal(auth.getState().outcome, OUTCOMES.SESSION_EXPIRED);

  client.setSessionResult(session("account-a"));
  const recovered = await auth.recoverSession();
  assert.equal(recovered.status, STATES.AUTHENTICATED);
  assert.equal(recovered.reason, "session_recovered");
});

test("callback completion can arrive through the subscribed Auth listener", async () => {
  const client = fakeClient();
  const auth = createAuthSession({ client });
  await auth.start();
  client.emit("SIGNED_IN", session("callback-account"));
  assert.equal(auth.getState().status, STATES.AUTHENTICATED);
  assert.equal(auth.getState().reason, "signed_in");
});

test("Auth errors normalize without raw diagnostic disclosure", () => {
  assert.equal(normalizeAuthError({ status: 429, message: "raw detail" }), OUTCOMES.RATE_LIMITED);
  assert.equal(normalizeAuthError({ code: "otp_expired", message: "raw detail" }, "verification"), OUTCOMES.EXPIRED_VERIFICATION);
  assert.equal(normalizeAuthError({ code: "otp_invalid", message: "raw detail" }, "verification"), OUTCOMES.VERIFICATION_FAILED);
  assert.equal(normalizeAuthError(new TypeError("Failed to fetch")), OUTCOMES.NETWORK_UNAVAILABLE);
  assert.equal(normalizeAuthError({ code: "refresh_token_not_found" }), OUTCOMES.SESSION_EXPIRED);
  assert.equal(normalizeAuthError({ message: "account unavailable" }, "email"), OUTCOMES.AUTHENTICATION_FAILED);
  assert.equal(normalizeAuthError({ message: "private database detail" }), OUTCOMES.AUTHENTICATION_FAILED);
});

test("service does not touch tracker LocalStorage or persist email/token data", async () => {
  const trackerStorage = new Map([["tvSeriesTrackerData.v1", '{"schemaVersion":1,"shows":[]}']]);
  const before = [...trackerStorage.entries()];
  const client = fakeClient();
  client.setVerifyResult({ data: { session: session("account-a") }, error: null });
  const auth = createAuthSession({ client });
  await auth.start();
  await auth.requestPasswordlessSignIn("viewer@example.test");
  await auth.verifyEmailOtp("viewer@example.test", "123456");
  await auth.signOut();
  assert.deepEqual([...trackerStorage.entries()], before);
  assert.equal(JSON.stringify(auth.getState()).includes("viewer@example.test"), false);
  assert.equal(JSON.stringify(auth.getState()).includes("not-observed"), false);
});

test("start is idempotent and installs only one listener", async () => {
  const client = fakeClient();
  const auth = createAuthSession({ client });
  await Promise.all([auth.start(), auth.start()]);
  assert.equal(client.calls.filter(([name]) => name === "listener").length, 1);
  assert.equal(client.calls.filter(([name]) => name === "getSession").length, 1);
});
