(function bootstrapModule(root, factory) {
  "use strict";

  const exported = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = exported;
  }

  if (root && root.document) {
    const bootstrap = exported.createSupabaseBootstrap({
      createClient(url, publishableKey, options) {
        if (!root.supabase || typeof root.supabase.createClient !== "function") {
          throw new exported.SupabaseBootstrapError("client_library_missing");
        }
        return root.supabase.createClient(url, publishableKey, options);
      },
      onStateChange(state) {
        root.document.documentElement.dataset.supabaseState = state.status;
      }
    });

    root.TV_TRACKER_SUPABASE = bootstrap;
    bootstrap.initialize(root.SUPABASE_CONFIG);
  }
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATES = Object.freeze({
    CONFIGURATION_MISSING: "configuration_missing",
    CONFIGURATION_PLACEHOLDER: "configuration_placeholder",
    CONFIGURATION_INVALID: "configuration_invalid",
    CLIENT_INITIALIZING: "client_initializing",
    CLIENT_LIBRARY_MISSING: "client_library_missing",
    CLIENT_INITIALIZATION_FAILED: "client_initialization_failed",
    READY: "ready"
  });

  const CLIENT_OPTIONS = Object.freeze({
    auth: Object.freeze({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    })
  });

  class SupabaseBootstrapError extends Error {
    constructor(code) {
      super(code);
      this.name = "SupabaseBootstrapError";
      this.code = code;
    }
  }

  function state(status, code = null) {
    return Object.freeze({ status, code });
  }

  function hasPlaceholder(value) {
    return /YOUR_|PLACEHOLDER|PROJECT_REF|PUBLISHABLE_KEY/i.test(value);
  }

  function decodeJwtPayload(value) {
    const segments = value.split(".");
    if (segments.length !== 3) return null;

    try {
      const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function isObviousSecretKey(value) {
    if (/^(?:sb_)?secret_/i.test(value) || /service[_-]?role/i.test(value)) return true;
    const payload = decodeJwtPayload(value);
    return payload && payload.role && payload.role !== "anon";
  }

  function validateSupabaseConfig(config) {
    if (config == null) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_MISSING, code: "supabase_config_missing" });
    }
    if (typeof config !== "object" || Array.isArray(config)) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_config_invalid" });
    }

    const keys = Object.keys(config).sort();
    if (keys.length !== 2 || keys[0] !== "publishableKey" || keys[1] !== "url") {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_config_keys_invalid" });
    }

    const urlValue = typeof config.url === "string" ? config.url.trim() : "";
    const keyValue = typeof config.publishableKey === "string" ? config.publishableKey.trim() : "";
    if (!urlValue || !keyValue) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_MISSING, code: "supabase_config_value_missing" });
    }
    if (hasPlaceholder(urlValue) || hasPlaceholder(keyValue)) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_PLACEHOLDER, code: "supabase_config_placeholder" });
    }
    if (isObviousSecretKey(keyValue)) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_secret_key_rejected" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlValue);
    } catch {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_url_invalid" });
    }

    const localHost = parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost";
    const protocolAllowed = parsedUrl.protocol === "https:" || (localHost && parsedUrl.protocol === "http:");
    if (!protocolAllowed || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || parsedUrl.pathname !== "/") {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_url_invalid" });
    }
    if (keyValue.length < 20 || /\s/.test(keyValue)) {
      return Object.freeze({ ok: false, status: STATES.CONFIGURATION_INVALID, code: "supabase_publishable_key_invalid" });
    }

    return Object.freeze({
      ok: true,
      status: STATES.READY,
      code: null,
      value: Object.freeze({ url: parsedUrl.href, publishableKey: keyValue })
    });
  }

  function createSupabaseBootstrap({ createClient, onStateChange = () => {} }) {
    if (typeof createClient !== "function") throw new TypeError("createClient is required");

    let currentState = state(STATES.CONFIGURATION_MISSING, "not_initialized");
    let client = null;

    function setState(status, code = null) {
      currentState = state(status, code);
      onStateChange(currentState);
    }

    return Object.freeze({
      initialize(config) {
        if (client) return currentState;

        const validation = validateSupabaseConfig(config);
        if (!validation.ok) {
          setState(validation.status, validation.code);
          return currentState;
        }

        setState(STATES.CLIENT_INITIALIZING);
        try {
          client = createClient(validation.value.url, validation.value.publishableKey, CLIENT_OPTIONS);
          if (!client) throw new Error("Client factory returned no client");
          setState(STATES.READY);
        } catch (error) {
          client = null;
          const missingLibrary = error && error.code === "client_library_missing";
          setState(
            missingLibrary ? STATES.CLIENT_LIBRARY_MISSING : STATES.CLIENT_INITIALIZATION_FAILED,
            missingLibrary ? "supabase_client_library_missing" : "supabase_client_initialization_failed"
          );
        }
        return currentState;
      },
      getState() {
        return currentState;
      },
      getClient() {
        return client;
      }
    });
  }

  return Object.freeze({
    CLIENT_OPTIONS,
    STATES,
    SupabaseBootstrapError,
    createSupabaseBootstrap,
    validateSupabaseConfig
  });
});
