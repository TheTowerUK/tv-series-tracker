(function authUiModule(root) {
  "use strict";

  if (!root || !root.document) return;

  const document = root.document;
  const bootstrap = root.TV_TRACKER_SUPABASE;
  const authModule = root.TV_TRACKER_AUTH_SESSION;
  const els = {
    panel: document.getElementById("accountPanel"),
    signedOut: document.getElementById("authSignedOut"),
    signedIn: document.getElementById("authSignedIn"),
    requestForm: document.getElementById("authRequestForm"),
    email: document.getElementById("authEmail"),
    send: document.getElementById("authSendBtn"),
    verification: document.getElementById("authVerification"),
    verificationForm: document.getElementById("authVerificationForm"),
    otp: document.getElementById("authOtp"),
    verify: document.getElementById("authVerifyBtn"),
    resend: document.getElementById("authResendBtn"),
    status: document.getElementById("authStatus"),
    signOut: document.getElementById("authSignOutBtn")
  };

  if (!els.panel || !bootstrap || !authModule) return;

  let service = null;

  const messages = Object.freeze({
    invalid_email: "Enter a valid email address.",
    verification_failed: "That verification code could not be confirmed. Check it and try again.",
    expired_verification: "That verification has expired. Send a new code or link.",
    rate_limited: "Too many authentication attempts. Wait a little before trying again.",
    session_expired: "Your cloud session expired. Sign in again; your local tracker is unchanged.",
    network_unavailable: "Authentication is temporarily unavailable. Check your connection and try again.",
    configuration_unavailable: "Cloud sign-in is not configured. Your local tracker remains available.",
    authentication_failed: "Authentication could not be completed. Please try again."
  });

  function setHidden(element, hidden) {
    element.classList.toggle("hidden", hidden);
  }

  function setBusy(busy) {
    els.email.disabled = busy;
    els.send.disabled = busy;
    els.otp.disabled = busy;
    els.verify.disabled = busy;
    els.resend.disabled = busy;
    els.signOut.disabled = busy;
  }

  function render(state) {
    const authenticated = state.status === authModule.STATES.AUTHENTICATED;
    const awaiting = state.status === authModule.STATES.AWAITING_VERIFICATION ||
      state.status === authModule.STATES.VERIFYING ||
      (state.reason === "verification_failed");
    const busy = state.status === authModule.STATES.INITIALIZING ||
      state.status === authModule.STATES.SENDING_VERIFICATION ||
      state.status === authModule.STATES.VERIFYING;

    setHidden(els.signedIn, !authenticated);
    setHidden(els.signedOut, authenticated);
    setHidden(els.verification, !awaiting || authenticated);
    setBusy(busy);

    if (authenticated) {
      els.email.value = "";
      els.otp.value = "";
      els.status.textContent = "Signed in. This step continues using the local tracker.";
    } else if (state.outcome) {
      els.status.textContent = messages[state.outcome] || messages.authentication_failed;
    } else if (state.status === authModule.STATES.INITIALIZING) {
      els.status.textContent = "Checking cloud session…";
    } else if (state.status === authModule.STATES.SENDING_VERIFICATION) {
      els.status.textContent = "Sending a private sign-in code or link…";
    } else if (state.status === authModule.STATES.AWAITING_VERIFICATION) {
      els.status.textContent = "Check your email. Open the sign-in link, or enter the verification code below.";
    } else {
      els.status.textContent = "Signed out. Your local tracker remains available.";
    }

    els.panel.dataset.authState = state.status;
  }

  async function sendVerification() {
    if (!service) return;
    await service.requestPasswordlessSignIn(els.email.value);
  }

  const bootstrapState = bootstrap.getState();
  const client = bootstrap.getClient();
  if (bootstrapState.status !== "ready" || !client) {
    els.email.disabled = true;
    els.send.disabled = true;
    els.status.textContent = messages.configuration_unavailable;
    els.panel.dataset.authState = authModule.STATES.CONFIGURATION_UNAVAILABLE;
    return;
  }

  service = authModule.createAuthSession({
    client,
    redirectUrl: `${root.location.origin}${root.location.pathname}`,
    onStateChange: render
  });
  root.TV_TRACKER_AUTH = service;

  els.requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendVerification();
  });
  els.verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await service.verifyEmailOtp(els.email.value, els.otp.value);
  });
  els.resend.addEventListener("click", sendVerification);
  els.signOut.addEventListener("click", async () => {
    await service.signOut();
  });

  service.start();
})(typeof globalThis === "object" ? globalThis : this);
