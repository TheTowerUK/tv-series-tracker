(function authSessionModule(root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_AUTH_SESSION = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATES = Object.freeze({
    CONFIGURATION_UNAVAILABLE: "configuration_unavailable",
    INITIALIZING: "initializing",
    SIGNED_OUT: "signed_out",
    SENDING_VERIFICATION: "sending_verification",
    AWAITING_VERIFICATION: "awaiting_verification",
    VERIFYING: "verifying",
    AUTHENTICATED: "authenticated",
    SESSION_EXPIRED: "session_expired",
    NETWORK_UNAVAILABLE: "network_unavailable",
    AUTHENTICATION_ERROR: "authentication_error"
  });

  const OUTCOMES = Object.freeze({
    INVALID_EMAIL: "invalid_email",
    VERIFICATION_FAILED: "verification_failed",
    EXPIRED_VERIFICATION: "expired_verification",
    RATE_LIMITED: "rate_limited",
    SESSION_EXPIRED: "session_expired",
    NETWORK_UNAVAILABLE: "network_unavailable",
    CONFIGURATION_UNAVAILABLE: "configuration_unavailable",
    AUTHENTICATION_FAILED: "authentication_failed"
  });

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function applicationState(status, options = {}) {
    return Object.freeze({
      status,
      outcome: options.outcome || null,
      accountId: options.accountId || null,
      reason: options.reason || null
    });
  }

  function normalizeAuthError(error, context = "authentication") {
    const code = String(error && error.code || "").toLowerCase();
    const message = String(error && error.message || "").toLowerCase();
    const rawStatus = error && error.status;
    const status = rawStatus == null ? null : Number(rawStatus);

    if (context === "configuration") return OUTCOMES.CONFIGURATION_UNAVAILABLE;
    if (status === 429 || /rate|too many|over_email_send_rate_limit/.test(`${code} ${message}`)) return OUTCOMES.RATE_LIMITED;
    if (/expired|otp_expired/.test(`${code} ${message}`)) return OUTCOMES.EXPIRED_VERIFICATION;
    if (/refresh_token|session.*(?:missing|expired)|jwt.*expired/.test(`${code} ${message}`)) return OUTCOMES.SESSION_EXPIRED;
    if (status === 0 || error instanceof TypeError || /fetch|network|offline/.test(message)) return OUTCOMES.NETWORK_UNAVAILABLE;
    if (context === "verification" || /otp|token.*invalid/.test(`${code} ${message}`)) return OUTCOMES.VERIFICATION_FAILED;
    if (/email.*invalid|invalid.*email/.test(`${code} ${message}`)) return OUTCOMES.INVALID_EMAIL;
    return OUTCOMES.AUTHENTICATION_FAILED;
  }

  function createAuthSession({ client, redirectUrl, onStateChange = () => {} }) {
    if (!client || !client.auth) throw new TypeError("A Supabase Auth client is required");
    if (typeof onStateChange !== "function") throw new TypeError("onStateChange must be a function");

    let currentState = applicationState(STATES.INITIALIZING);
    const listeners = new Set([onStateChange]);
    let accountId = null;
    let subscription = null;
    let startPromise = null;
    let explicitSignOut = false;

    function setState(status, options = {}) {
      currentState = applicationState(status, options);
      for (const listener of listeners) listener(currentState);
      return currentState;
    }

    function userIdFromSession(session) {
      const id = session && session.user && session.user.id;
      return typeof id === "string" && id ? id : null;
    }

    function applySession(session, reason) {
      const nextAccountId = userIdFromSession(session);
      if (!nextAccountId) {
        accountId = null;
        return setState(STATES.SIGNED_OUT, { reason });
      }
      const changed = Boolean(accountId && accountId !== nextAccountId);
      accountId = nextAccountId;
      return setState(STATES.AUTHENTICATED, {
        accountId,
        reason: changed ? "account_changed" : reason
      });
    }

    function handleAuthEvent(event, session) {
      if (event === "SIGNED_OUT") {
        const expired = Boolean(accountId) && !explicitSignOut;
        accountId = null;
        explicitSignOut = false;
        return setState(expired ? STATES.SESSION_EXPIRED : STATES.SIGNED_OUT, {
          outcome: expired ? OUTCOMES.SESSION_EXPIRED : null,
          reason: expired ? "session_expired" : "signed_out"
        });
      }
      if (event === "TOKEN_REFRESHED") return applySession(session, "token_refreshed");
      if (event === "SIGNED_IN") return applySession(session, "signed_in");
      if (event === "INITIAL_SESSION") return applySession(session, "initial_session");
      if (event === "USER_UPDATED") return applySession(session, "user_updated");
      return currentState;
    }

    async function start() {
      if (startPromise) return startPromise;
      startPromise = (async () => {
        setState(STATES.INITIALIZING);
        const listener = client.auth.onAuthStateChange(handleAuthEvent);
        subscription = listener && listener.data && listener.data.subscription || null;

        try {
          const result = await client.auth.getSession();
          if (result.error) throw result.error;
          return applySession(result.data && result.data.session, "session_restored");
        } catch (error) {
          accountId = null;
          const outcome = normalizeAuthError(error);
          if (outcome === OUTCOMES.SESSION_EXPIRED) {
            return setState(STATES.SESSION_EXPIRED, { outcome, reason: "session_restore_failed" });
          }
          return setState(
            outcome === OUTCOMES.NETWORK_UNAVAILABLE ? STATES.NETWORK_UNAVAILABLE : STATES.AUTHENTICATION_ERROR,
            { outcome, reason: "session_restore_failed" }
          );
        }
      })();
      return startPromise;
    }

    async function requestPasswordlessSignIn(email) {
      const normalizedEmail = typeof email === "string" ? email.trim() : "";
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        return setState(STATES.AUTHENTICATION_ERROR, { outcome: OUTCOMES.INVALID_EMAIL, reason: "sign_in_failed" });
      }

      setState(STATES.SENDING_VERIFICATION);
      try {
        const options = { shouldCreateUser: false };
        if (redirectUrl) options.emailRedirectTo = redirectUrl;
        const result = await client.auth.signInWithOtp({ email: normalizedEmail, options });
        if (result.error) throw result.error;
        return setState(STATES.AWAITING_VERIFICATION, { reason: "verification_sent" });
      } catch (error) {
        const outcome = normalizeAuthError(error, "email");
        return setState(
          outcome === OUTCOMES.NETWORK_UNAVAILABLE ? STATES.NETWORK_UNAVAILABLE : STATES.AUTHENTICATION_ERROR,
          { outcome, reason: "sign_in_failed" }
        );
      }
    }

    async function verifyEmailOtp(email, token) {
      const normalizedEmail = typeof email === "string" ? email.trim() : "";
      const normalizedToken = typeof token === "string" ? token.trim() : "";
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        return setState(STATES.AUTHENTICATION_ERROR, { outcome: OUTCOMES.INVALID_EMAIL, reason: "verification_failed" });
      }
      if (!/^\d{6,8}$/.test(normalizedToken)) {
        return setState(STATES.AUTHENTICATION_ERROR, { outcome: OUTCOMES.VERIFICATION_FAILED, reason: "verification_failed" });
      }

      setState(STATES.VERIFYING);
      try {
        const result = await client.auth.verifyOtp({ email: normalizedEmail, token: normalizedToken, type: "email" });
        if (result.error) throw result.error;
        return applySession(result.data && result.data.session, "otp_verified");
      } catch (error) {
        const outcome = normalizeAuthError(error, "verification");
        return setState(
          outcome === OUTCOMES.NETWORK_UNAVAILABLE ? STATES.NETWORK_UNAVAILABLE : STATES.AUTHENTICATION_ERROR,
          { outcome, reason: "verification_failed" }
        );
      }
    }

    async function recoverSession() {
      try {
        const result = await client.auth.getSession();
        if (result.error) throw result.error;
        return applySession(result.data && result.data.session, "session_recovered");
      } catch (error) {
        accountId = null;
        const outcome = normalizeAuthError(error);
        return setState(
          outcome === OUTCOMES.NETWORK_UNAVAILABLE ? STATES.NETWORK_UNAVAILABLE : STATES.SESSION_EXPIRED,
          { outcome, reason: "session_recovery_failed" }
        );
      }
    }

    async function signOut() {
      explicitSignOut = true;
      accountId = null;
      try {
        const result = await client.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
        explicitSignOut = false;
        return setState(STATES.SIGNED_OUT, { reason: "signed_out" });
      } catch (error) {
        explicitSignOut = false;
        const outcome = normalizeAuthError(error);
        return setState(
          outcome === OUTCOMES.NETWORK_UNAVAILABLE ? STATES.NETWORK_UNAVAILABLE : STATES.AUTHENTICATION_ERROR,
          { outcome, reason: "sign_out_failed" }
        );
      }
    }

    function dispose() {
      if (subscription && typeof subscription.unsubscribe === "function") subscription.unsubscribe();
      subscription = null;
      accountId = null;
      listeners.clear();
    }

    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("listener must be a function");
      listeners.add(listener);
      listener(currentState);
      return () => listeners.delete(listener);
    }

    return Object.freeze({
      dispose,
      getState: () => currentState,
      recoverSession,
      requestPasswordlessSignIn,
      signOut,
      start,
      subscribe,
      verifyEmailOtp
    });
  }

  return Object.freeze({ OUTCOMES, STATES, createAuthSession, normalizeAuthError });
});
