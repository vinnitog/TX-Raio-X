const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

let webhook;

test.before(async () => {
  webhook = await import("../supabase/functions/_shared/mercado-pago-webhook.mjs");
});

const paymentId = "171456370708";
const orderId = "35ca9da5-e3ca-417f-a240-2d75d6855e17";
const collectorId = "123456789";
const secret = "test-webhook-secret";

function signature(requestId = "request-1", timestamp = "1720000000") {
  const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
  return `ts=${timestamp},v1=${createHmac("sha256", secret).update(manifest).digest("hex")}`;
}

function payment(overrides = {}) {
  return {
    id: Number(paymentId),
    live_mode: false,
    collector_id: Number(collectorId),
    external_reference: orderId,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 4.9,
    transaction_amount_refunded: 0,
    currency_id: "BRL",
    date_approved: "2026-07-31T22:09:10.000Z",
    date_last_updated: "2026-07-31T22:09:11.000Z",
    order: { id: 99887766, type: "mercadopago" },
    ...overrides
  };
}

function request({ body, requestId = "request-1", signatureValue = signature(requestId), queryId = paymentId } = {}) {
  return new Request(`https://project.supabase.co/functions/v1/mercado-pago-webhook?data.id=${queryId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": signatureValue
    },
    body: JSON.stringify(body ?? { type: "payment", data: { id: paymentId } })
  });
}

function createHarness(options = {}) {
  const calls = { fetch: 0, merchant: 0, load: 0, process: 0, logs: [] };
  const handler = webhook.createMercadoPagoWebhookHandler({
    loadConfig: () => ({
      environment: "test",
      webhookSecret: secret,
      collectorId,
      paymentLiveMode: options.paymentLiveMode ?? false
    }),
    fetchPayment: async () => {
      calls.fetch += 1;
      return payment(options.paymentOverrides);
    },
    fetchMerchantOrder: async () => {
      calls.merchant += 1;
      return options.merchantOrder ?? {
        id: 99887766,
        preference_id: "pref-123",
        external_reference: orderId,
        payments: [{ id: Number(paymentId) }]
      };
    },
    loadOrder: async () => {
      calls.load += 1;
      return options.order ?? {
        id: orderId,
        provider: "mercado_pago",
        provider_preference_id: "pref-123",
        amount_cents: 490,
        currency: "BRL"
      };
    },
    processPayment: async () => {
      calls.process += 1;
      return options.result ?? { credited: true, reversed: false };
    },
    logger: { error: (...args) => calls.logs.push(args) }
  });
  return { handler, calls };
}

test("validates the official HMAC manifest", async () => {
  assert.equal(await webhook.verifyMercadoPagoSignature({
    dataId: paymentId,
    requestId: "request-1",
    signature: signature(),
    secret
  }), true);
  assert.equal(await webhook.verifyMercadoPagoSignature({
    dataId: paymentId,
    requestId: "tampered",
    signature: signature(),
    secret
  }), false);
  assert.throws(
    () => webhook.parseSignature("ts=1,ts=2,v1=" + "a".repeat(64)),
    /Duplicate signature field/
  );
});

test("rejects an invalid signature before provider and database calls", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(request({ signatureValue: `ts=1,v1=${"0".repeat(64)}` }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_signature" });
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
});

test("rejects disagreement between signed query and body", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(request({ body: { type: "payment", data: { id: "999" } } }));
  assert.equal(response.status, 400);
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
});

test("acknowledges the Mercado Pago empty URL probe without side effects", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(new Request(
    "https://project.supabase.co/functions/v1/mercado-pago-webhook",
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: true, probe: true });
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
});

for (const [name, url, headers, body] of [
  ["empty body", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, ""],
  ["null JSON", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, "null"],
  ["array JSON", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, "[]"],
  ["payment type body", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, '{"type":"payment"}'],
  ["non-empty object", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, '{"probe":true}'],
  ["nested empty object", "https://project.supabase.co/functions/v1/mercado-pago-webhook", {}, '{"data":{}}'],
  ["payment query", "https://project.supabase.co/functions/v1/mercado-pago-webhook?type=payment", {}, "{}"],
  ["unrelated query", "https://project.supabase.co/functions/v1/mercado-pago-webhook?source=panel", {}, "{}"],
  ["signature header", "https://project.supabase.co/functions/v1/mercado-pago-webhook", { "x-signature": "invalid" }, "{}"],
  ["empty signature header", "https://project.supabase.co/functions/v1/mercado-pago-webhook", { "x-signature": "" }, "{}"],
  ["request ID header", "https://project.supabase.co/functions/v1/mercado-pago-webhook", { "x-request-id": "request-1" }, "{}"],
  ["empty request ID header", "https://project.supabase.co/functions/v1/mercado-pago-webhook", { "x-request-id": "" }, "{}"]
]) {
  test(`does not treat ${name} as a URL probe`, async () => {
    const { handler, calls } = createHarness();
    const response = await handler(new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body
    }));
    assert.notEqual(response.status, 200);
    assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
  });
}

test("fetches authoritative payment and processes a matching order", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, credited: true, reversed: false });
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [1, 1, 1, 1]);
});

test("acknowledges signed non-payment notifications without side effects", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(request({ body: { type: "merchant_order", data: { id: paymentId } } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, ignored: true });
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
});

for (const [name, paymentOverrides, expectedCode] of [
  ["unexpected live mode", { live_mode: true }, "live_mode_mismatch"],
  ["other collector", { collector_id: 987654321 }, "collector_mismatch"],
  ["other payment ID", { id: 999 }, "payment_id_mismatch"],
  ["missing order reference", { external_reference: "invalid" }, "invalid_external_reference"],
  ["fractional cent", { transaction_amount: 4.901 }, "invalid_payment_snapshot"],
  ["excess refund", { transaction_amount_refunded: 5 }, "invalid_payment_snapshot"],
  ["unknown status", { status: "mystery" }, "unsupported_payment_status"]
]) {
  test(`rejects ${name} before database writes`, async () => {
    const { handler, calls } = createHarness({ paymentOverrides });
    const response = await handler(request());
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, expectedCode);
    assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [1, 0, 0, 0]);
  });
}

test("rejects payment values that disagree with the immutable order snapshot", async () => {
  const { handler, calls } = createHarness({
    order: {
      id: orderId,
      provider: "mercado_pago",
      provider_preference_id: "pref-123",
      amount_cents: 990,
      currency: "BRL"
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "order_payment_mismatch");
  assert.deepEqual([calls.fetch, calls.load, calls.merchant, calls.process], [1, 1, 0, 0]);
});

test("rejects a payment not linked to the stored checkout preference", async () => {
  const { handler, calls } = createHarness({
    merchantOrder: {
      id: 99887766,
      preference_id: "another-preference",
      external_reference: orderId,
      payments: [{ id: Number(paymentId) }]
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "merchant_order_mismatch");
  assert.deepEqual([calls.fetch, calls.load, calls.merchant, calls.process], [1, 1, 1, 0]);
});

test("requires the body payment ID instead of inferring it from the signed query", async () => {
  const { handler, calls } = createHarness();
  const response = await handler(request({ body: { type: "payment", data: {} } }));
  assert.equal(response.status, 400);
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [0, 0, 0, 0]);
});

test("accepts every documented payment lifecycle state for transactional processing", () => {
  for (const status of [
    "approved", "authorized", "cancelled", "charged_back", "in_mediation",
    "in_process", "pending", "refunded", "rejected"
  ]) {
    assert.equal(webhook.normalizePayment(payment({ status }), paymentId, collectorId, false).status, status);
  }
});

test("keeps error responses free of provider payload and personal data", async () => {
  const { handler, calls } = createHarness({
    paymentOverrides: { payer: { email: "private@example.com" }, collector_id: 987 }
  });
  const response = await handler(request());
  assert.deepEqual(await response.json(), { error: "collector_mismatch" });
  assert.equal(JSON.stringify(calls.logs).includes("private@example.com"), false);
});

test("fails closed when JSON numeric IDs exceed JavaScript safe precision", () => {
  assert.throws(
    () => webhook.normalizePayment(payment({ id: Number.MAX_SAFE_INTEGER + 1 }), paymentId, collectorId, false),
    (error) => error.code === "unsafe_provider_id"
  );
  assert.throws(
    () => webhook.validateMerchantOrder({
      id: 99887766,
      preference_id: "pref-123",
      external_reference: orderId,
      payments: [{ id: Number.MAX_SAFE_INTEGER + 1 }]
    }, webhook.normalizePayment(payment(), paymentId, collectorId, false), {
      id: orderId,
      provider_preference_id: "pref-123"
    }),
    (error) => error.code === "unsafe_provider_id"
  );
});

test("accepts the explicitly configured live mode for a test-account payment", () => {
  assert.equal(
    webhook.normalizePayment(payment({ live_mode: true }), paymentId, collectorId, true).status,
    "approved"
  );
});

test("handler processes the explicitly configured live mode end to end", async () => {
  const { handler, calls } = createHarness({
    paymentLiveMode: true,
    paymentOverrides: { live_mode: true }
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, credited: true, reversed: false });
  assert.deepEqual([calls.fetch, calls.merchant, calls.load, calls.process], [1, 1, 1, 1]);
});

test("boolean configuration parsing is strict and whitespace tolerant", () => {
  assert.equal(webhook.parseBooleanConfig(" TRUE "), true);
  assert.equal(webhook.parseBooleanConfig("false"), false);
  assert.equal(webhook.parseBooleanConfig("FaLsE"), false);
  for (const value of [
    undefined, null, "", "1", "0", "yes", "no", "on", "off", "test",
    "true false", "false true", "truthy", "falsy"
  ]) {
    assert.throws(() => webhook.parseBooleanConfig(value), /must be true or false/);
  }
});
