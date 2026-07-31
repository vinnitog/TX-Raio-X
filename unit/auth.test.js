const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");

async function importModule(file) {
  return import(pathToFileURL(path.join(root, file)).href);
}

function createFakeElement(initial = {}) {
  const listeners = new Map();
  const classes = new Set();
  return Object.assign({
    hidden: false,
    disabled: false,
    open: false,
    value: "",
    textContent: "",
    autocomplete: "",
    attributes: new Map(),
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    },
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    async emit(type, properties = {}) {
      const event = {
        target: this,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...properties
      };
      for (const listener of listeners.get(type) ?? []) await listener(event);
      return event;
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelectorAll() { return this.controls ?? []; },
    closest() { return null; },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    reset() { this.wasReset = true; }
  }, initial);
}

function createAuthElements() {
  const elements = {};
  for (const name of [
    "trigger", "triggerLabel", "dialog", "close", "guestView", "accountView",
    "recoveryView", "googleButton", "form", "title", "subtitle", "email",
    "password", "submit", "submitLabel", "switchMode", "forgotPassword",
    "feedback", "accountEmail", "logout", "recoveryForm", "recoveryPassword",
    "recoveryConfirmation", "recoverySubmit", "recoveryFeedback"
  ]) {
    elements[name] = createFakeElement();
  }
  elements.accountView.hidden = true;
  elements.recoveryView.hidden = true;
  elements.dialog.controls = [
    elements.close,
    elements.googleButton,
    elements.email,
    elements.password,
    elements.submit,
    elements.switchMode,
    elements.forgotPassword,
    elements.logout,
    elements.recoveryPassword,
    elements.recoveryConfirmation,
    elements.recoverySubmit
  ];
  elements.recoveryForm.reset = () => {
    elements.recoveryPassword.value = "";
    elements.recoveryConfirmation.value = "";
  };
  return elements;
}

function createFakeAuth(overrides = {}) {
  return {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithGoogle: async () => ({ data: {}, error: null }),
    signInWithPassword: async () => ({ data: { session: {} }, error: null }),
    signUp: async () => ({ data: { session: null }, error: null }),
    resetPassword: async () => ({ data: {}, error: null }),
    updatePassword: async () => ({ data: {}, error: null }),
    signOut: async () => ({ error: null }),
    ...overrides
  };
}

async function initController(elements, auth) {
  const { initAuthController } = await importModule("js/auth-controller.mjs");
  await initAuthController({
    elements,
    loadAuth: async () => auth,
    scheduleFrame: (callback) => callback()
  });
}

test("auth redirect keeps the current deployment base without query or hash", async () => {
  const { getAuthRedirectUrl } = await importModule("js/auth-config.mjs");

  assert.equal(
    getAuthRedirectUrl({ href: "https://vinnitog.github.io/TX-Raio-X/?code=secret#token" }),
    "https://vinnitog.github.io/TX-Raio-X/"
  );
  assert.equal(
    getAuthRedirectUrl({ href: "http://localhost:4173/index.html?mode=test" }),
    "http://localhost:4173/"
  );
});

test("auth service sends only public credentials and safe redirect options", async () => {
  const { createAuthService } = await importModule("js/auth-service.mjs");
  const calls = [];
  const response = { data: {}, error: null };
  const client = {
    auth: {
      getSession: () => response,
      onAuthStateChange: (callback) => ({ callback }),
      signInWithOAuth: (payload) => { calls.push(["oauth", payload]); return response; },
      signInWithPassword: (payload) => { calls.push(["sign-in", payload]); return response; },
      signUp: (payload) => { calls.push(["sign-up", payload]); return response; },
      resetPasswordForEmail: (email, options) => { calls.push(["reset", email, options]); return response; },
      updateUser: (payload) => { calls.push(["update", payload]); return response; },
      signOut: (payload) => { calls.push(["sign-out", payload]); return response; }
    }
  };
  const redirectTo = "https://example.test/app/";
  const auth = createAuthService(client, redirectTo);

  await auth.signInWithGoogle();
  await auth.signInWithPassword("user@example.test", "password");
  await auth.signUp("user@example.test", "password");
  await auth.resetPassword("user@example.test");
  await auth.updatePassword("new-password");
  await auth.signOut();

  assert.deepEqual(calls, [
    ["oauth", { provider: "google", options: { redirectTo } }],
    ["sign-in", { email: "user@example.test", password: "password" }],
    ["sign-up", {
      email: "user@example.test",
      password: "password",
      options: { emailRedirectTo: redirectTo }
    }],
    ["reset", "user@example.test", { redirectTo }],
    ["update", { password: "new-password" }],
    ["sign-out", { scope: "local" }]
  ]);
});

test("auth controller recovers the UI after thrown network errors", () => {
  const fs = require("node:fs");
  const controller = fs.readFileSync(path.join(root, "js/auth-controller.mjs"), "utf8");

  assert.match(controller, /async function runAuthRequest/);
  assert.match(controller, /catch \(error\) \{\s*return \{ data: null, error \};/);
  assert.match(controller, /finally \{\s*setBusy\(false\);/);
});

test("auth controller switches between sign-in and sign-up without changing usage storage", async () => {
  const elements = createAuthElements();
  const auth = createFakeAuth();
  const originalLocalStorage = global.localStorage;
  let storageAccesses = 0;
  global.localStorage = new Proxy({}, {
    get() {
      storageAccesses += 1;
      throw new Error("Auth must not access usage storage");
    }
  });

  try {
    await initController(elements, auth);
    await elements.trigger.emit("click");
    assert.equal(elements.dialog.open, true);
    assert.equal(elements.title.textContent, "Entre na sua conta");
    assert.equal(elements.password.autocomplete, "current-password");

    await elements.switchMode.emit("click");
    assert.equal(elements.title.textContent, "Crie sua conta");
    assert.equal(elements.submitLabel.textContent, "Criar conta");
    assert.equal(elements.forgotPassword.hidden, true);
    assert.equal(elements.password.autocomplete, "new-password");
    assert.equal(storageAccesses, 0);
  } finally {
    if (originalLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalLocalStorage;
  }
});

test("auth controller exposes busy state only during the active request and renders safe errors", async () => {
  const elements = createAuthElements();
  let rejectGoogle;
  const auth = createFakeAuth({
    signInWithGoogle: () => new Promise((resolve, reject) => {
      rejectGoogle = reject;
    })
  });
  await initController(elements, auth);

  const request = elements.googleButton.emit("click");
  await Promise.resolve();
  assert.equal(elements.dialog.getAttribute("aria-busy"), "true");
  assert.equal(elements.googleButton.classList.contains("is-loading"), true);
  assert.equal(elements.dialog.controls.every((control) => control.disabled), true);

  rejectGoogle(new TypeError("private network details"));
  await request;
  assert.equal(elements.dialog.getAttribute("aria-busy"), "false");
  assert.equal(elements.googleButton.classList.contains("is-loading"), false);
  assert.equal(elements.dialog.controls.every((control) => !control.disabled), true);
  assert.equal(elements.feedback.textContent, "Não foi possível conectar. Verifique sua internet.");
  assert.equal(elements.feedback.classList.contains("is-error"), true);
  assert.doesNotMatch(elements.feedback.textContent, /private network details/);
});

test("auth controller renders an existing session and completes password recovery", async () => {
  const elements = createAuthElements();
  let authStateChange;
  const updatedPasswords = [];
  const session = { user: { email: "pessoa@example.test" } };
  const auth = createFakeAuth({
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (callback) => {
      authStateChange = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
    updatePassword: async (password) => {
      updatedPasswords.push(password);
      return { data: {}, error: null };
    }
  });
  await initController(elements, auth);

  assert.equal(elements.guestView.hidden, true);
  assert.equal(elements.accountView.hidden, false);
  assert.equal(elements.triggerLabel.textContent, "pessoa@example.test");
  assert.equal(elements.accountEmail.textContent, "pessoa@example.test");

  authStateChange("PASSWORD_RECOVERY", session);
  assert.equal(elements.dialog.open, true);
  assert.equal(elements.recoveryView.hidden, false);
  assert.equal(elements.recoveryPassword.focused, true);

  elements.recoveryPassword.value = "nova-senha-segura";
  elements.recoveryConfirmation.value = "nova-senha-segura";
  await elements.recoveryForm.emit("submit");
  assert.deepEqual(updatedPasswords, ["nova-senha-segura"]);
  assert.equal(elements.dialog.open, false);
  assert.equal(elements.recoveryPassword.value, "");
  assert.equal(elements.recoveryConfirmation.value, "");
});

test("auth client loading failure disables only the optional account entry point", async () => {
  const { initAuthController } = await importModule("js/auth-controller.mjs");
  const elements = createAuthElements();
  let storageAccesses = 0;
  const originalLocalStorage = global.localStorage;
  global.localStorage = new Proxy({}, {
    get() {
      storageAccesses += 1;
      throw new Error("Usage storage must remain independent");
    }
  });

  try {
    await assert.doesNotReject(initAuthController({
      elements,
      loadAuth: async () => { throw new TypeError("CDN unavailable"); },
      scheduleFrame: (callback) => callback()
    }));
    assert.equal(elements.trigger.disabled, true);
    assert.equal(elements.triggerLabel.textContent, "Conta indisponível");
    assert.equal(elements.trigger.getAttribute("aria-label"), "Conta indisponível sem conexão");
    assert.equal(storageAccesses, 0);
  } finally {
    if (originalLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = originalLocalStorage;
  }
});

test("auth modules remain independent from anonymous usage and payment state", () => {
  const fs = require("node:fs");
  const authSources = ["auth-config.mjs", "auth-controller.mjs", "auth-service.mjs", "supabase-client.mjs"]
    .map((file) => fs.readFileSync(path.join(root, "js", file), "utf8"))
    .join("\n");

  assert.doesNotMatch(authSources, /localStorage|usage\.mjs|consumeAnalysis|addCredits|applyCreditGrant/);
});

test("auth messages do not expose account existence and email labels stay compact", async () => {
  const { compactEmail, getAuthErrorMessage } = await importModule("js/auth-service.mjs");

  assert.equal(getAuthErrorMessage({ code: "invalid_credentials" }), "E-mail ou senha incorretos.");
  assert.doesNotMatch(getAuthErrorMessage({ code: "email_exists" }), /já existe/i);
  assert.equal(compactEmail("curto@example.com"), "curto@example.com");
  assert.match(compactEmail("um-endereco-muito-comprido@example.com", 24), /…@example\.com$/);
});

test("frontend auth configuration contains only the public Supabase key", async () => {
  const config = await importModule("js/auth-config.mjs");

  assert.equal(config.SUPABASE_URL, "https://pvonnavvdegzorykioxw.supabase.co");
  assert.match(config.SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.doesNotMatch(config.SUPABASE_PUBLISHABLE_KEY, /service_role|secret/i);
});
