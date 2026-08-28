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
  let trackerAuthority = "local";

  const messages = Object.freeze({
    invalid_email: "Enter a valid email address.",
    verification_failed: "That verification code could not be confirmed. Check it and try again.",
    expired_verification: "That verification has expired. Send a new code or link.",
    rate_limited: "Too many authentication attempts. Wait a little before trying again.",
    session_expired: "Your cloud session expired. Sign in again; your device tracker is unchanged.",
    network_unavailable: "Authentication is temporarily unavailable. Check your connection and try again.",
    configuration_unavailable: "Cloud sign-in is not configured. Your device tracker remains available.",
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

  function authenticatedMessage() {
    return trackerAuthority.startsWith("cloud_")
      ? "Your private cloud tracker is active. This device tracker is preserved and returns after sign-out."
      : "Signed in. Your device tracker remains active while your private cloud tracker is checked.";
  }

  function setTrackerAuthority(authority) {
    trackerAuthority = typeof authority === "string" ? authority : "local";
    if (service && service.getState().status === authModule.STATES.AUTHENTICATED) {
      els.status.textContent = authenticatedMessage();
    }
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
      els.status.textContent = authenticatedMessage();
    } else if (state.outcome) {
      els.status.textContent = messages[state.outcome] || messages.authentication_failed;
    } else if (state.status === authModule.STATES.INITIALIZING) {
      els.status.textContent = "Checking cloud session…";
    } else if (state.status === authModule.STATES.SENDING_VERIFICATION) {
      els.status.textContent = "Sending a private sign-in code or link…";
    } else if (state.status === authModule.STATES.AWAITING_VERIFICATION) {
      els.status.textContent = "Check your email. Open the sign-in link, or enter the verification code below.";
    } else {
      els.status.textContent = "Signed out. Your device tracker remains available.";
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
  root.TV_TRACKER_AUTH_UI = Object.freeze({ setTrackerAuthority });

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
