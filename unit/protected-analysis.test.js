const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const analysisId = "60000000-0000-4000-8000-000000000001";
const hash = `0x${"a".repeat(64)}`;
const origin = "https://app.example.com";

async function createHarness(overrides = {}) {
  const calls = [];
  const { createProtectedAnalysisHandler } = await import(
    "../supabase/functions/_shared/protected-analysis.mjs"
  );
  const handler = createProtectedAnalysisHandler({
    loadAllowedOrigins: () => new Set([origin]),
    authenticate: async () => ({ id: "user-1" }),
    enforceRateLimit: async () => true,
    loadEntitlement: async () => ({ balance: 0, free_remaining: 2 }),
    loadReceipt: async () => null,
    findTransaction: async (receivedHash, network) => {
      calls.push(["find", receivedHash, network]);
      return { network: { name: "Base" }, transaction: { hash: receivedHash } };
    },
    analyzeTransaction: () => ({ title: "Resultado protegido" }),
    finalizeAnalysis: async (_userId, receivedId, fingerprint) => {
      calls.push(["finalize", receivedId, fingerprint]);
      return { consumed: true, applied: true, conflict: false,
        balance: 0, free_remaining: 1, source: "free" };
    },
    logger: { info() {}, error() {} },
    ...overrides
  });
  return { handler, calls };
}

function request(body = { analysisId, hash, network: "base" }, headers = {}) {
  return new Request("https://functions.example/analyze-transaction", {
    method: "POST",
    headers: { Origin: origin, Authorization: "Bearer valid", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

test("protected endpoint authenticates, rate limits and rejects empty entitlement before RPC", async () => {
  const events = [];
  const { handler } = await createHarness({
    authenticate: async () => { events.push("auth"); return { id: "user-1" }; },
    enforceRateLimit: async () => { events.push("limit"); return true; },
    loadEntitlement: async () => { events.push("entitlement"); return { balance: 0, free_remaining: 0 }; },
    findTransaction: async () => { events.push("rpc"); return {}; }
  });
  const response = await handler(request());
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), { error: "credits_exhausted" });
  assert.deepEqual(events, ["auth", "limit", "entitlement"]);
});

test("protected endpoint returns analysis only after atomic finalization", async () => {
  const { handler, calls } = await createHarness();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("X-Request-Id"), /.+/);
  const body = await response.json();
  assert.equal(body.analysis.title, "Resultado protegido");
  assert.deepEqual(body.entitlement, { balance: 0, freeRemaining: 1 });
  assert.deepEqual(body.consumption, { source: "free", applied: true });
  assert.equal(calls[0][0], "find");
  assert.equal(calls[1][0], "finalize");
  assert.match(calls[1][2], /^[0-9a-f]{64}$/);
});

test("an idempotent replay can recover the last consumed analysis at zero balance", async () => {
  const { fingerprintProtectedAnalysis } = await import(
    "../supabase/functions/_shared/protected-analysis.mjs"
  );
  const fingerprint = await fingerprintProtectedAnalysis(hash, "base");
  const { handler, calls } = await createHarness({
    loadEntitlement: async () => ({ balance: 0, free_remaining: 0 }),
    loadReceipt: async () => ({ request_fingerprint: fingerprint }),
    finalizeAnalysis: async () => ({
      consumed: true, applied: false, conflict: false,
      balance: 0, free_remaining: 0, source: "free"
    })
  });

  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).consumption.applied, false);
  assert.equal(calls[0][0], "find");
});

test("a receipt without a server-side fingerprint cannot bypass exhausted credits", async () => {
  const { handler } = await createHarness({
    loadEntitlement: async () => ({ balance: 0, free_remaining: 0 }),
    loadReceipt: async () => ({ legacy: true })
  });
  assert.equal((await handler(request())).status, 402);
});

test("idempotency conflict never returns the computed analysis", async () => {
  const { handler } = await createHarness({
    finalizeAnalysis: async () => ({ conflict: true, consumed: false })
  });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "analysis_conflict" });
});

test("strict body, origin and limiter failures are side-effect free", async () => {
  let finds = 0;
  const { handler } = await createHarness({
    findTransaction: async () => { finds += 1; return {}; }
  });
  assert.equal((await handler(request({ analysisId, hash, network: "base", price: 0 }))).status, 400);
  const hostile = request();
  hostile.headers.set("Origin", "https://evil.example");
  assert.equal((await handler(hostile)).status, 403);

  const limited = await createHarness({ enforceRateLimit: async () => false });
  assert.equal((await limited.handler(request())).status, 429);
  assert.equal(finds, 0);
});

test("entry point keeps provider logic and service credentials off the public app", () => {
  const root = path.join(__dirname, "..");
  const entry = fs.readFileSync(path.join(root, "supabase/functions/analyze-transaction/index.ts"), "utf8");
  const app = fs.readFileSync(path.join(root, "js/app.mjs"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
  assert.match(entry, /finalize_protected_analysis/);
  assert.match(entry, /get_service_credit_entitlement/);
  assert.match(entry, /p_scope:\s*"protected_analysis"/);
  assert.match(app, /\.analyze\(hash, networkId, expectedCreditUserId\)/);
  assert.doesNotMatch(app, /^import .*transaction-(?:chain|analyzer)/m);
  assert.match(workflow, /path:\s*"_site"/);
});

test("service entitlement removes fully reversed paid access", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase/migrations/20260802000300_protected_analysis.sql"),
    "utf8"
  );
  assert.match(migration, /reversal\.payment_id = purchase\.payment_id/);
  assert.match(migration, /reversal\.entry_type in \('refund', 'chargeback'\)/);
});
