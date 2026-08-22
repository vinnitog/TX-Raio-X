const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "..");
const NOW = Date.parse("2026-08-22T15:00:00.000Z");
const EMAIL = "pessoa@example.com";

async function setup(overrides = {}) {
  const { createPrivacyAccountHandler } = await import(pathToFileURL(path.join(
    root, "supabase/functions/_shared/privacy-account.mjs"
  )).href);
  const calls = [];
  const dependencies = {
    loadAllowedOrigins: () => new Set(["https://app.example.com"]),
    authenticate: async () => ({ user: {
      id: "10000000-0000-4000-8000-000000000001",
      email: EMAIL,
      identities: [{ provider: "email" }],
      created_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: new Date(NOW - 60_000).toISOString()
    }, issuedAt: Math.floor(NOW / 1000) - 60 }),
    enforceRateLimit: async () => true,
    exportAccount: async () => ({ orders: [], payments: [], creditLedger: [] }),
    checkErasureEligibility: async () => ({ paidBalance: 0, hasOpenCheckout: false }),
    beginErasure: async () => { calls.push("begin"); return "request-1"; },
    deleteAccount: async () => { calls.push("delete"); },
    completeErasure: async (_id, status) => { calls.push(status); },
    now: () => NOW,
    logger: { info() {}, error() {} },
    ...overrides
  };
  return { handler: createPrivacyAccountHandler(dependencies), calls };
}

function request(body, options = {}) {
  return new Request("https://functions.example.com/privacy-account", {
    method: options.method ?? "POST",
    headers: {
      Origin: options.origin ?? "https://app.example.com",
      Authorization: options.authorization ?? "Bearer valid-token",
      "Content-Type": options.contentType ?? "application/json"
    },
    body: (options.method ?? "POST") === "POST" ? JSON.stringify(body) : undefined
  });
}

test("rejects untrusted origins and missing sessions before any privacy effect", async () => {
  let authenticated = 0;
  const { handler } = await setup({ authenticate: async () => { authenticated += 1; return null; } });
  const forbidden = await handler(request({ action: "export" }, { origin: "https://evil.example" }));
  assert.equal(forbidden.status, 403);
  assert.equal(authenticated, 0);
  const unauthorized = await handler(request({ action: "export" }, { authorization: "" }));
  assert.equal(unauthorized.status, 401);
});

test("exports only the authenticated account snapshot with no-store", async () => {
  const { handler } = await setup();
  const response = await handler(request({ action: "export" }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.account.email, EMAIL);
  assert.deepEqual(payload.account.providers, ["email"]);
  assert.deepEqual(payload.orders, []);
});

test("export rejects injected account selectors before loading account data", async () => {
  let exports = 0;
  const { handler } = await setup({
    exportAccount: async () => { exports += 1; return {}; }
  });
  const response = await handler(request({
    action: "export",
    userId: "20000000-0000-4000-8000-000000000002"
  }));
  assert.equal(response.status, 400);
  assert.equal(exports, 0);
});

test("deletion needs exact confirmation and recent independently verified session times", async () => {
  const mismatch = await setup();
  assert.equal((await mismatch.handler(request({ action: "delete", confirmation: "wrong@example.com" }))).status, 400);
  assert.deepEqual(mismatch.calls, []);

  const stale = await setup({ authenticate: async () => ({ user: {
    id: "10000000-0000-4000-8000-000000000001", email: EMAIL,
    last_sign_in_at: new Date(NOW - 700_000).toISOString()
  }, issuedAt: Math.floor(NOW / 1000) - 700 }) });
  const staleResponse = await stale.handler(request({ action: "delete", confirmation: EMAIL }));
  assert.equal(staleResponse.status, 403);
  assert.deepEqual(await staleResponse.json(), { error: "recent_authentication_required" });
  assert.deepEqual(stale.calls, []);

  const staleSignInOnly = await setup({ authenticate: async () => ({ user: {
    id: "10000000-0000-4000-8000-000000000001", email: EMAIL,
    last_sign_in_at: new Date(NOW - 700_000).toISOString()
  }, issuedAt: Math.floor(NOW / 1000) - 60 }) });
  assert.equal((await staleSignInOnly.handler(request({
    action: "delete", confirmation: EMAIL
  }))).status, 403);

  const staleTokenOnly = await setup({ authenticate: async () => ({ user: {
    id: "10000000-0000-4000-8000-000000000001", email: EMAIL,
    last_sign_in_at: new Date(NOW - 60_000).toISOString()
  }, issuedAt: Math.floor(NOW / 1000) - 700 }) });
  assert.equal((await staleTokenOnly.handler(request({
    action: "delete", confirmation: EMAIL
  }))).status, 403);
});

test("successful deletion records processing before hard delete and completion after it", async () => {
  const { handler, calls } = await setup();
  const response = await handler(request({ action: "delete", confirmation: EMAIL.toUpperCase() }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(calls, ["begin", "delete", "completed"]);
});

test("processing marker is persisted before financial eligibility is evaluated", async () => {
  const events = [];
  const { handler } = await setup({
    beginErasure: async () => { events.push("processing"); return "request-1"; },
    checkErasureEligibility: async () => {
      events.push("eligibility");
      return { paidBalance: 0, hasOpenCheckout: false };
    },
    deleteAccount: async () => { events.push("delete"); }
  });
  const response = await handler(request({ action: "delete", confirmation: EMAIL }));
  assert.equal(response.status, 200);
  assert.deepEqual(events, ["processing", "eligibility", "delete"]);
});

test("deletion records a failed attempt and stops before hard delete for unsafe eligibility", async () => {
  for (const eligibility of [
    { paidBalance: 1, hasOpenCheckout: false },
    { paidBalance: 0, hasOpenCheckout: true },
    null,
    {},
    { paidBalance: "invalid", hasOpenCheckout: false },
    { paidBalance: -1, hasOpenCheckout: false },
    { paidBalance: 0.5, hasOpenCheckout: false },
    { paidBalance: Number.MAX_SAFE_INTEGER + 1, hasOpenCheckout: false },
    { paidBalance: 0, hasOpenCheckout: "true" }
  ]) {
    const { handler, calls } = await setup({ checkErasureEligibility: async () => eligibility });
    const response = await handler(request({ action: "delete", confirmation: EMAIL }));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "account_has_financial_commitments" });
    assert.deepEqual(calls, ["begin", "failed"]);
  }
});

test("eligibility lookup failure releases the processing erasure marker", async () => {
  const { handler, calls } = await setup({
    checkErasureEligibility: async () => { throw new Error("database unavailable"); }
  });
  const response = await handler(request({ action: "delete", confirmation: EMAIL }));
  assert.equal(response.status, 500);
  assert.deepEqual(calls, ["begin", "failed"]);
});

test("failed hard deletion leaves a sanitized audited failure", async () => {
  const { handler, calls } = await setup({
    deleteAccount: async () => { calls.push("delete"); throw new Error("private provider details"); }
  });
  const response = await handler(request({ action: "delete", confirmation: EMAIL }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
  assert.deepEqual(calls, ["begin", "delete", "failed"]);
});

test("completed deletion stays successful when its audit completion is temporarily unavailable", async () => {
  const { handler, calls } = await setup({
    completeErasure: async (_id, status) => {
      calls.push(status);
      if (status === "completed") throw new Error("database temporarily unavailable");
    }
  });
  const response = await handler(request({ action: "delete", confirmation: EMAIL }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(calls, ["begin", "delete", "completed"]);
});

test("entry point keeps admin deletion and service key server-side", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(path.join(root, "supabase/functions/privacy-account/index.ts"), "utf8");
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /auth\.admin\.deleteUser\(userId, false\)/);
  assert.match(source, /rpc\("complete_account_erasure"/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:token|email)/i);
});

test("financial commitment message is honest without inventing a support channel", async () => {
  const { getPrivacyErrorMessage } = await import(pathToFileURL(path.join(
    root, "js/privacy-client.mjs"
  )).href);
  const message = getPrivacyErrorMessage({ code: "account_has_financial_commitments" });
  assert.match(message, /saldo pago ou pagamento em andamento/);
  assert.match(message, /será disponibilizado antes da produção/);
  assert.doesNotMatch(message, /entre em contato|fale com|suporte@|mailto:|WhatsApp/i);
});
