const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const origin = "https://vinnitog.github.io";
const analysisId = "10000000-0000-4000-8000-000000000001";

async function createHandler(overrides = {}) {
  const { createConsumeAnalysisHandler } = await import(
    `../supabase/functions/_shared/consume-analysis.mjs?test=${Math.random()}`
  );
  const calls = { authenticate: 0, consume: 0 };
  const handler = createConsumeAnalysisHandler({
    loadAllowedOrigins: () => new Set([origin]),
    authenticate: async (token) => {
      calls.authenticate += 1;
      return token === "valid" ? { id: "user-1" } : null;
    },
    consumeCredit: async (userId, requestedId) => {
      calls.consume += 1;
      return {
        consumed: true, applied: true, balance: 10,
        free_remaining: 1, source: "free", userId, requestedId
      };
    },
    logger: { error() {} },
    ...overrides
  });
  return { handler, calls };
}

function request({ method = "POST", body = { analysisId }, headers = {}, url = "https://api.example/consume" } = {}) {
  return new Request(url, {
    method,
    headers: {
      Origin: origin,
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
      ...headers
    },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("allowed preflight is side-effect free and hostile origins fail closed", async () => {
  const { handler, calls } = await createHandler();
  const preflight = await handler(request({ method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /\bx-client-info\b/i);
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");

  const hostile = await handler(request({ headers: { Origin: "https://evil.example" } }));
  assert.equal(hostile.status, 403);
  assert.deepEqual(await hostile.json(), { error: "origin_not_allowed" });
  assert.deepEqual(calls, { authenticate: 0, consume: 0 });
});

test("function entry point delegates to the shared handler with gateway JWT verification disabled", () => {
  const root = path.resolve(__dirname, "..");
  const entry = fs.readFileSync(path.join(root, "supabase/functions/consume-analysis/index.ts"), "utf8");
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");

  assert.match(entry, /Deno\.serve\(createConsumeAnalysisHandler\(\{/);
  assert.match(entry, /auth\.getUser\(token\)/);
  assert.match(entry, /\.rpc\("consume_analysis_credit",\s*\{[\s\S]*?p_user_id:\s*userId,[\s\S]*?p_analysis_id:\s*analysisId/);
  assert.match(config, /\[functions\.consume-analysis\]\s*verify_jwt\s*=\s*false/);
});

test("authentication happens before parsing and consuming", async () => {
  const { handler, calls } = await createHandler();
  const missing = await handler(request({ headers: { Authorization: "" } }));
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: "authentication_required" });
  assert.deepEqual(calls, { authenticate: 0, consume: 0 });

  const invalid = await handler(request({ headers: { Authorization: "Bearer invalid" } }));
  assert.equal(invalid.status, 401);
  assert.deepEqual(calls, { authenticate: 1, consume: 0 });
});

test("method, content type and body size fail closed before consumption", async () => {
  const methodCase = await createHandler();
  const methodResponse = await methodCase.handler(request({ method: "PUT" }));
  assert.equal(methodResponse.status, 405);
  assert.deepEqual(methodCase.calls, { authenticate: 0, consume: 0 });

  const typeCase = await createHandler();
  const typeResponse = await typeCase.handler(request({ headers: { "Content-Type": "text/plain" } }));
  assert.equal(typeResponse.status, 415);
  assert.deepEqual(typeCase.calls, { authenticate: 1, consume: 0 });

  const sizeCase = await createHandler();
  const oversized = new Request("https://api.example/consume", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer valid",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ analysisId, padding: "x".repeat(1100) })
  });
  const sizeResponse = await sizeCase.handler(oversized);
  assert.equal(sizeResponse.status, 413);
  assert.deepEqual(sizeCase.calls, { authenticate: 1, consume: 0 });
});

test("strict request validation rejects injected fields without consuming", async () => {
  for (const body of [null, [], {}, { analysisId: "bad" }, { analysisId, amount: 10 }]) {
    const { handler, calls } = await createHandler();
    const response = await handler(request({ body }));
    assert.equal(response.status, 400);
    assert.equal(calls.consume, 0);
  }
});

test("a confirmed transaction returns the remaining account balance", async () => {
  let received;
  const { handler, calls } = await createHandler({
    consumeCredit: async (userId, requestedId) => {
      calls.consume += 1;
      received = { userId, requestedId };
      return {
        consumed: true, applied: true, balance: "10",
        free_remaining: "1", source: "free"
      };
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    consumed: true, applied: true, balance: 10,
    freeRemaining: 1, source: "free"
  });
  assert.deepEqual(received, { userId: "user-1", requestedId: analysisId });
  assert.deepEqual(calls, { authenticate: 1, consume: 1 });
});

test("idempotent replay succeeds without claiming another application", async () => {
  const { handler } = await createHandler({
    consumeCredit: async () => ({
      consumed: true, applied: false, balance: 9,
      free_remaining: 0, source: "paid"
    })
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    consumed: true, applied: false, balance: 9,
    freeRemaining: 0, source: "paid"
  });
});

test("empty balance returns payment required and no financial details", async () => {
  const { handler } = await createHandler({
    consumeCredit: async () => ({ consumed: false, applied: false, balance: 0 })
  });
  const response = await handler(request());
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), { error: "credits_exhausted" });
});

test("invalid database responses and thrown details become sanitized 500 errors", async () => {
  for (const consumeCredit of [
    async () => ({
      consumed: true, applied: true, balance: -1,
      free_remaining: 0, source: "paid"
    }),
    async () => ({
      consumed: true, applied: true, balance: 1,
      free_remaining: -1, source: "free"
    }),
    async () => { throw new Error("secret database payload"); }
  ]) {
    const { handler } = await createHandler({ consumeCredit });
    const response = await handler(request());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal_error" });
  }
});
