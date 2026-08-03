export const MOCK_SUPABASE_MODULE = String.raw`
import { createDemoAnalysis } from "./demo-analysis.mjs";

const SESSION_KEY = "txraiox:e2e:session";
const ENTITLEMENT_KEY = "txraiox:e2e:entitlement";
const SHARED_BACKEND_URL = globalThis.__txRaioXE2EBackendUrl ?? null;
const listeners = new Set();

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}

function writeSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function entitlement() {
  if (SHARED_BACKEND_URL) {
    const response = await fetch(SHARED_BACKEND_URL, {
      headers: { "X-E2E-User-Id": readSession()?.user?.id ?? "" }
    });
    if (!response.ok) throw new Error("Shared E2E entitlement unavailable");
    return response.json();
  }
  try {
    return { balance: 0, freeRemaining: 2, hasPaidAccess: false,
      ...JSON.parse(localStorage.getItem(ENTITLEMENT_KEY) ?? "{}") };
  } catch {
    return { balance: 0, freeRemaining: 2, hasPaidAccess: false };
  }
}

function emit(event, session = readSession()) {
  writeSession(session);
  for (const listener of listeners) listener(event, session);
}

window.__txRaioXE2E = Object.freeze({
  emit,
  setEntitlement(value) { localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value)); },
  getGoogleRedirect() { return localStorage.getItem("txraiox:e2e:google-redirect"); }
});

const auth = {
  async getSession() { return { data: { session: readSession() }, error: null }; },
  onAuthStateChange(callback) {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
  async signInWithOAuth({ options }) {
    localStorage.setItem("txraiox:e2e:google-redirect", options.redirectTo);
    return { data: { url: "https://accounts.google.test/oauth" }, error: null };
  },
  async signUp({ email }) {
    localStorage.setItem("txraiox:e2e:last-signup", email);
    return { data: { user: { email }, session: null }, error: null };
  },
  async signInWithPassword({ email, password }) {
    if (password !== "SenhaForte123") {
      return { data: null, error: { code: "invalid_credentials", status: 400 } };
    }
    const session = { access_token: "e2e-token", user: {
      id: "10000000-0000-4000-8000-000000000001", email
    } };
    emit("SIGNED_IN", session);
    return { data: { session, user: session.user }, error: null };
  },
  async resetPasswordForEmail(email) {
    localStorage.setItem("txraiox:e2e:last-recovery", email);
    return { data: {}, error: null };
  },
  async updateUser({ password }) {
    localStorage.setItem("txraiox:e2e:updated-password-length", String(password.length));
    return { data: { user: readSession()?.user }, error: null };
  },
  async signOut() {
    emit("SIGNED_OUT", null);
    return { error: null };
  }
};

function ordersQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: null }; }
  };
}

export const supabase = {
  auth,
  from(table) { if (table !== "orders") throw new Error("Unexpected table"); return ordersQuery(); },
  async rpc(name) {
    if (name !== "get_credit_entitlement") {
      return { data: null, error: { code: "unexpected_rpc" } };
    }
    const value = await entitlement();
    return { data: [{
      balance: value.balance,
      free_remaining: value.freeRemaining,
      has_paid_access: value.hasPaidAccess
    }], error: null };
  },
  functions: {
    async invoke(name) {
      if (name === "checkout") {
        return { data: {
          environment: "test",
          orderId: "20000000-0000-4000-8000-000000000001",
          checkoutUrl: "https://sandbox.mercadopago.com/checkout/v1/redirect/e2e"
        }, error: null };
      }
      if (name === "consume-analysis") {
        const value = await entitlement();
        if (SHARED_BACKEND_URL) {
          const response = await fetch(SHARED_BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-E2E-User-Id": readSession()?.user?.id ?? "" },
            body: JSON.stringify({ action: "consume" })
          });
          const payload = await response.json();
          return response.ok ? { data: payload, error: null } : {
            data: null,
            error: { context: new Response(JSON.stringify(payload), { status: response.status }) }
          };
        }
        const source = value.freeRemaining > 0 ? "free" : "paid";
        if (source === "free") value.freeRemaining -= 1;
        else value.balance -= 1;
        localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value));
        return { data: { consumed: true, applied: true, source,
          balance: value.balance, freeRemaining: value.freeRemaining }, error: null };
      }
      if (name === "analyze-transaction") {
        if (SHARED_BACKEND_URL) {
          const response = await fetch(SHARED_BACKEND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-E2E-User-Id": readSession()?.user?.id ?? "" },
            body: JSON.stringify({ action: "analyze" })
          });
          const payload = await response.json();
          if (!response.ok) return { data: null, error: { context: new Response(
            JSON.stringify(payload),
            { status: response.status, headers: { "content-type": "application/json" } }
          ) } };
          return { data: { analysis: createDemoAnalysis(), ...payload }, error: null };
        }
        const value = await entitlement();
        if (value.freeRemaining + value.balance < 1) {
          return { data: null, error: { context: new Response(
            JSON.stringify({ error: "credits_exhausted" }),
            { status: 402, headers: { "content-type": "application/json" } }
          ) } };
        }
        const source = value.freeRemaining > 0 ? "free" : "paid";
        if (source === "free") value.freeRemaining -= 1;
        else value.balance -= 1;
        localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(value));
        return { data: {
          analysis: createDemoAnalysis(),
          consumption: { source, applied: true },
          entitlement: { balance: value.balance, freeRemaining: value.freeRemaining }
        }, error: null };
      }
      return { data: null, error: { code: "unexpected_function" } };
    }
  }
};
`;

export async function mockSupabase(page, { session = null, entitlement = null, sharedBackend = null } = {}) {
  if (sharedBackend) await sharedBackend.attach(page);
  await page.addInitScript(({ sessionValue, entitlementValue, backendUrl }) => {
    if (!crypto.randomUUID) {
      Object.defineProperty(crypto, "randomUUID", {
        value: () => "80000000-0000-4000-8000-000000000001"
      });
    }
    if (!crypto.subtle) {
      Object.defineProperty(crypto, "subtle", {
        value: {
          async digest() {
            return new Uint8Array(32).buffer;
          }
        }
      });
    }
    if (sessionValue) localStorage.setItem("txraiox:e2e:session", JSON.stringify(sessionValue));
    if (entitlementValue) {
      localStorage.setItem("txraiox:e2e:entitlement", JSON.stringify(entitlementValue));
    }
    if (backendUrl) globalThis.__txRaioXE2EBackendUrl = backendUrl;
  }, {
    sessionValue: session,
    entitlementValue: entitlement,
    backendUrl: sharedBackend ? "/__txraiox_e2e_backend" : null
  });
  await page.route("**/js/supabase-client.mjs", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: MOCK_SUPABASE_MODULE
  }));
}

export function createSharedEntitlementBackend(initialAccounts = {}) {
  const accounts = new Map(Object.entries(initialAccounts).map(([userId, value]) => [
    userId,
    { balance: 0, freeRemaining: 2, hasPaidAccess: false, ...value }
  ]));
  const delays = new Map();
  const account = (userId) => {
    if (!accounts.has(userId)) {
      accounts.set(userId, { balance: 0, freeRemaining: 2, hasPaidAccess: false });
    }
    return accounts.get(userId);
  };
  const snapshot = (userId) => ({ ...account(userId) });

  return Object.freeze({
    async attach(page) {
      await page.route("**/__txraiox_e2e_backend", async (route) => {
        const request = route.request();
        const userId = request.headers()["x-e2e-user-id"] ?? "";
        const delay = delays.get(userId) ?? 0;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const value = account(userId);
        if (request.method() === "GET") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
          return;
        }
        const { action } = request.postDataJSON();
        if (!["analyze", "consume"].includes(action)) {
          await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"invalid_action"}' });
          return;
        }
        if (value.freeRemaining + value.balance < 1) {
          await route.fulfill({ status: 402, contentType: "application/json", body: '{"error":"credits_exhausted"}' });
          return;
        }
        const source = value.freeRemaining > 0 ? "free" : "paid";
        if (source === "free") value.freeRemaining -= 1;
        else value.balance -= 1;
        const payload = action === "analyze"
          ? { consumption: { source, applied: true }, entitlement: {
              balance: value.balance, freeRemaining: value.freeRemaining
            } }
          : { consumed: true, applied: true, source,
              balance: value.balance, freeRemaining: value.freeRemaining };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
      });
    },
    set(userId, value) { accounts.set(userId, { ...account(userId), ...value }); },
    setDelay(userId, milliseconds) { delays.set(userId, milliseconds); },
    reverse(userId) { accounts.set(userId, { ...account(userId), balance: 0, hasPaidAccess: false }); },
    snapshot
  });
}

export const E2E_SESSION = Object.freeze({
  access_token: "e2e-token",
  user: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "conta.e2e@example.com"
  }
});
