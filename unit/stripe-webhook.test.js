const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

let webhook;
test.before(async () => { webhook = await import("../supabase/functions/_shared/stripe-webhook.mjs"); });
const secret = "whsec_abcdefghijklmnop";
const now = 1_780_000_000_000;
const orderId = "35ca9da5-e3ca-417f-a240-2d75d6855e17";
const priceId = "price_testpack10";
const eventId = "evt_abcdefgh1234";
const sessionId = "cs_test_abcdefgh1234";
const paymentIntentId = "pi_abcdefgh1234";

function signature(body, timestamp = Math.floor(now / 1000)) { return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`; }
function order() { return { id: orderId, provider: "stripe", provider_environment: "test", provider_checkout_session_id: sessionId, provider_price_id: priceId, package_code: "analysis_pack_10", amount_cents: 490, currency: "BRL" }; }
function session() { return { id: sessionId, mode: "payment", status: "complete", payment_status: "paid", client_reference_id: orderId, metadata: { order_id: orderId, package_code: "analysis_pack_10" }, payment_intent: paymentIntentId, amount_total: 490, currency: "brl", line_items: { data: [{ quantity: 1, price: { id: priceId } }] } }; }
function paymentIntent(overrides = {}) { return { id: paymentIntentId, amount: 490, currency: "brl", status: "requires_payment_method", metadata: { order_id: orderId, package_code: "analysis_pack_10" }, last_payment_error: { code: "card_declined" }, ...overrides }; }
function charge(overrides = {}) { return { id: "ch_abcdefgh1234", payment_intent: paymentIntentId, amount: 490, amount_refunded: 490, currency: "brl", ...overrides }; }
function event(type = "checkout.session.completed", object = { id: sessionId }) { return { id: eventId, type, livemode: false, created: Math.floor(now / 1000), data: { object } }; }
function request(payload, signatureValue) { const body = JSON.stringify(payload); return new Request("https://project.supabase.co/functions/v1/stripe-webhook", { method: "POST", headers: { "Stripe-Signature": signatureValue ?? signature(body), "Content-Type": "application/json" }, body }); }

test("verifies Stripe HMAC with timestamp tolerance and constant-time comparison", async () => {
  const body = JSON.stringify(event());
  assert.equal(await webhook.verifyStripeWebhookSignature({ rawBody: body, signatureHeader: signature(body), secret, now }), true);
  assert.equal(await webhook.verifyStripeWebhookSignature({ rawBody: body, signatureHeader: signature(body, Math.floor(now / 1000) - 301), secret, now }), false);
  assert.equal(await webhook.verifyStripeWebhookSignature({ rawBody: body, signatureHeader: `t=${Math.floor(now / 1000)},v1=${"0".repeat(64)}`, secret, now }), false);
});

test("normalizes only a paid one-time session matching price, order, amount and environment", () => {
  const normalized = webhook.normalizePaidCheckoutSession(session(), order(), { environment: "test", priceId }, new Date(now).toISOString());
  assert.equal(normalized.status, "approved");
  assert.equal(normalized.providerPaymentId, paymentIntentId);
  assert.throws(() => webhook.normalizePaidCheckoutSession({ ...session(), amount_total: 491 }, order(), { environment: "test", priceId }, new Date(now).toISOString()), /does not match|invalid/i);
  assert.throws(() => webhook.normalizePaidCheckoutSession({ ...session(), line_items: { data: [{ quantity: 1, price: { id: "price_another123" } }] } }, order(), { environment: "test", priceId }, new Date(now).toISOString()), /invalid/i);
});

test("invalid signature and live events fail before Stripe or database calls", async () => {
  const calls = [];
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }),
    fetchStripe: async () => { calls.push("fetch"); }, loadOrder: async () => { calls.push("load"); }, processPayment: async () => { calls.push("process"); }, now: () => now, logger: { error() {} }
  });
  let response = await handler(request(event(), `t=${Math.floor(now / 1000)},v1=${"0".repeat(64)}`));
  assert.equal(response.status, 400);
  response = await handler(request({ ...event(), livemode: true }));
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("signed paid checkout is refetched authoritatively and processed once by the RPC dependency", async () => {
  const calls = [];
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }),
    fetchStripe: async (path) => { calls.push(["fetch", path]); return session(); },
    loadOrder: async (id) => { calls.push(["load", id]); return order(); },
    processPayment: async (payment, metadata) => { calls.push(["process", payment.status, metadata.eventId]); return { credited: true, reversed: false }; },
    now: () => now, logger: { error() {} }
  });
  const response = await handler(request(event()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, credited: true, reversed: false });
  assert.deepEqual(calls.map((call) => call[0]), ["fetch", "load", "process"]);
});

test("unhandled signed event is acknowledged without provider or database calls", async () => {
  let called = false;
  const handler = webhook.createStripeWebhookHandler({ loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }), fetchStripe: async () => { called = true; }, loadOrder: async () => { called = true; }, processPayment: async () => { called = true; }, now: () => now, logger: { error() {} } });
  const response = await handler(request(event("customer.created", { id: "cus_abcdefgh1234" })));
  assert.equal(response.status, 200);
  assert.equal(called, false);
});

test("partial refund remains distinct from a full refund", () => {
  const intent = { id: paymentIntentId, metadata: { order_id: orderId, package_code: "analysis_pack_10" } };
  const partial = webhook.normalizeStripeReversal({ id: "ch_abcdefgh1234", payment_intent: paymentIntentId, amount: 490, amount_refunded: 100, currency: "brl" }, intent, order(), { environment: "test" }, new Date(now).toISOString(), false);
  const full = webhook.normalizeStripeReversal({ id: "ch_abcdefgh1234", payment_intent: paymentIntentId, amount: 490, amount_refunded: 490, currency: "brl" }, intent, order(), { environment: "test" }, new Date(now).toISOString(), false);
  assert.equal(partial.status, "partially_refunded");
  assert.equal(full.status, "refunded");
});

test("pending checkout is acknowledged without loading an order or granting credits", async () => {
  let databaseCalled = false;
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret }),
    fetchStripe: async () => ({ ...session(), payment_status: "unpaid" }),
    loadOrder: async () => { databaseCalled = true; },
    processPayment: async () => { databaseCalled = true; },
    now: () => now,
    logger: { error() {} }
  });
  const response = await handler(request(event()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, credited: false, reversed: false });
  assert.equal(databaseCalled, false);
});

test("expired checkout is refetched and closes only its matching order", async () => {
  let expiration = null;
  const expiredSession = { ...session(), status: "expired", payment_status: "unpaid" };
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret }),
    fetchStripe: async () => expiredSession,
    loadOrder: async () => order(),
    processExpiration: async (snapshot) => { expiration = snapshot; },
    now: () => now,
    logger: { error() {} }
  });
  const response = await handler(request(event("checkout.session.expired")));
  assert.equal(response.status, 200);
  assert.deepEqual(expiration, { orderId, sessionId });
});

test("failed PaymentIntent is refetched and persisted without credit", async () => {
  const intent = paymentIntent();
  let normalized = null;
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret }),
    fetchStripe: async () => intent,
    loadOrder: async () => order(),
    processPayment: async (payment) => { normalized = payment; return { credited: false, reversed: false }; },
    now: () => now,
    logger: { error() {} }
  });
  const response = await handler(request(event("payment_intent.payment_failed", { id: paymentIntentId })));
  assert.equal(response.status, 200);
  assert.equal(normalized.status, "rejected");
  assert.equal(normalized.statusDetail, "card_declined");
});

test("async checkout success and failure reach the payment RPC with authoritative snapshots", async () => {
  const scenarios = [
    {
      eventType: "checkout.session.async_payment_succeeded",
      responses: [session()],
      expectedStatus: "approved",
      expectedPaths: [`/checkout/sessions/${sessionId}?expand[]=line_items.data.price&expand[]=payment_intent`]
    },
    {
      eventType: "checkout.session.async_payment_failed",
      responses: [{ ...session(), payment_status: "unpaid" }, paymentIntent()],
      expectedStatus: "rejected",
      expectedPaths: [
        `/checkout/sessions/${sessionId}?expand[]=line_items.data.price&expand[]=payment_intent`,
        `/payment_intents/${paymentIntentId}`
      ]
    }
  ];

  for (const scenario of scenarios) {
    const paths = [];
    let processed = null;
    const responses = [...scenario.responses];
    const handler = webhook.createStripeWebhookHandler({
      loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }),
      fetchStripe: async (path) => { paths.push(path); return responses.shift(); },
      loadOrder: async () => order(),
      processPayment: async (payment, metadata) => {
        processed = { payment, metadata };
        return { credited: payment.status === "approved", reversed: false };
      },
      now: () => now,
      logger: { error() {} }
    });
    const response = await handler(request(event(scenario.eventType)));
    assert.equal(response.status, 200, scenario.eventType);
    assert.equal(processed.payment.status, scenario.expectedStatus, scenario.eventType);
    assert.equal(processed.metadata.eventType, scenario.eventType);
    assert.deepEqual(paths, scenario.expectedPaths, scenario.eventType);
  }
});

test("dispute handler refetches charge and intent before recording one chargeback", async () => {
  const paths = [];
  let processed = null;
  const handler = webhook.createStripeWebhookHandler({
    loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }),
    fetchStripe: async (path) => {
      paths.push(path);
      if (path.startsWith("/charges/")) return charge();
      return paymentIntent({ status: "succeeded" });
    },
    loadOrder: async () => order(),
    processPayment: async (payment) => { processed = payment; return { credited: false, reversed: true }; },
    now: () => now,
    logger: { error() {} }
  });
  const response = await handler(request(event("charge.dispute.created", { charge: "ch_abcdefgh1234" })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, credited: false, reversed: true });
  assert.equal(processed.status, "charged_back");
  assert.equal(processed.refundedCents, 490);
  assert.deepEqual(paths, [`/charges/ch_abcdefgh1234`, `/payment_intents/${paymentIntentId}`]);
});

test("tampered paid sessions fail before any financial write", async () => {
  const otherOrderId = "45ca9da5-e3ca-417f-a240-2d75d6855e18";
  const cases = [
    ["amount", { amount_total: 491 }],
    ["currency", { currency: "usd" }],
    ["price", { line_items: { data: [{ quantity: 1, price: { id: "price_forgedpack" } }] } }],
    ["package", { metadata: { order_id: orderId, package_code: "forged_pack" } }],
    ["order", { metadata: { order_id: otherOrderId, package_code: "analysis_pack_10" } }],
    ["session", { id: "cs_test_forgedsession" }]
  ];

  for (const [label, mutation] of cases) {
    let writes = 0;
    const handler = webhook.createStripeWebhookHandler({
      loadConfig: () => ({ environment: "test", webhookSecret: secret, priceId }),
      fetchStripe: async () => ({ ...session(), ...mutation }),
      loadOrder: async () => order(),
      processPayment: async () => { writes += 1; },
      processExpiration: async () => { writes += 1; },
      now: () => now,
      logger: { error() {} }
    });
    const response = await handler(request(event()));
    assert.equal(response.status, 422, label);
    assert.equal(writes, 0, label);
  }
});
