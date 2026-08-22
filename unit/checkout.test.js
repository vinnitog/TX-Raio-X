const assert = require("node:assert/strict");
const test = require("node:test");

let checkout;
test.before(async () => { checkout = await import("../supabase/functions/_shared/checkout.mjs"); });

const key = "018e2f16-2e2a-4b88-a231-2bda2696f741";
const orderId = "35ca9da5-e3ca-417f-a240-2d75d6855e17";
const priceId = "price_testpack10";

function order(overrides = {}) {
  return { id: orderId, provider: "stripe", provider_environment: "test", provider_checkout_session_id: null, provider_price_id: priceId, status: "creating_checkout", package_code: "analysis_pack_10", amount_cents: 490, currency: "BRL", updated_at: "2026-08-22T12:00:00Z", ...overrides };
}

function session(row = order(), overrides = {}) {
  return { id: "cs_test_abcdefgh1234", url: "https://checkout.stripe.com/c/pay/cs_test_abcdefgh1234", mode: "payment", status: "open", payment_status: "unpaid", client_reference_id: row.id, metadata: { order_id: row.id, package_code: row.package_code }, amount_total: row.amount_cents, currency: "brl", ...overrides };
}

test("server owns the one-time offer and Stripe form payload", () => {
  assert.deepEqual(checkout.CHECKOUT_OFFER, { code: "analysis_pack_10", credits: 10, amountCents: 490, currency: "BRL", title: "Tx Raio-X — pacote com 10 análises" });
  const payload = checkout.buildStripeCheckoutPayload(orderId, priceId, "https://app.example.com/");
  assert.equal(payload.get("mode"), "payment");
  assert.equal(payload.get("line_items[0][price]"), priceId);
  assert.equal(payload.get("line_items[0][quantity]"), "1");
  assert.equal(payload.get("client_reference_id"), orderId);
  assert.match(payload.get("success_url"), /checkout_status=success/);
  assert.match(payload.get("success_url"), /session_id=%7BCHECKOUT_SESSION_ID%7D/);
  assert.match(payload.get("cancel_url"), /checkout_status=cancelled/);
});

test("checkout is locked to Stripe test credentials and HTTPS", () => {
  assert.doesNotThrow(() => checkout.validateCheckoutConfig({ environment: "test", returnUrl: "https://app.example.com/", priceId }));
  assert.throws(() => checkout.validateCheckoutConfig({ environment: "live", returnUrl: "https://app.example.com/", priceId }), /production is disabled/i);
  assert.throws(() => checkout.validateCheckoutConfig({ environment: "test", returnUrl: "http://app.example.com/", priceId }), /HTTPS/);
  assert.equal(checkout.validateStripeSecretKey("sk_test_abcdefghijklmnop", "test"), "sk_test_abcdefghijklmnop");
  assert.throws(() => checkout.validateStripeSecretKey("sk_live_abcdefghijklmnop", "test"), /sk_test_/);
});

test("Stripe session must match the immutable order and exact checkout host", () => {
  const row = order();
  assert.equal(checkout.validateStripeCheckoutSession(session(row), row).id, "cs_test_abcdefgh1234");
  assert.throws(() => checkout.validateStripeCheckoutSession(session(row, { amount_total: 491 }), row), /does not match/);
  assert.throws(() => checkout.getStripeCheckoutUrl({ url: "https://checkout.stripe.com.evil.test/c/pay/x" }), /invalid checkout URL/);
});

test("request, recovery and CORS validation fail closed", () => {
  assert.deepEqual(checkout.validateCheckoutRequest({ packageCode: "analysis_pack_10" }, key), { ok: true, idempotencyKey: key });
  assert.equal(checkout.validateCheckoutRequest({ packageCode: "forged" }, key).code, "invalid_package");
  assert.equal(checkout.isCheckoutRecoveryDue("2026-08-22T12:00:00Z", Date.parse("2026-08-22T12:05:00Z")), true);
  const origins = checkout.getAllowedOrigins("https://app.example.com/", "https://admin.example.com");
  assert.equal(checkout.getCorsHeaders("https://app.example.com", origins)["Access-Control-Allow-Origin"], "https://app.example.com");
  assert.equal(checkout.getCorsHeaders("https://app.example.com.evil", origins)["Access-Control-Allow-Origin"], undefined);
});

test("handler creates the order before Stripe and reuses the linked session", async () => {
  const events = [];
  let row = order();
  let created = true;
  const handler = checkout.createCheckoutHandler({
    loadConfig: () => ({ environment: "test", returnUrl: "https://app.example.com/", priceId, allowedOrigins: "" }),
    authenticate: async () => ({ id: "user-1" }),
    createOrGetOrder: async ({ idempotencyKey, environment }) => { events.push(["order", idempotencyKey, environment]); return { order: row, created }; },
    acquireRecoveryLease: async () => row,
    markCreationStatus: async () => true,
    linkSession: async (_order, id) => { events.push(["link", id]); row = { ...row, provider_checkout_session_id: id, status: "checkout_ready" }; return row; },
    stripeRequest: async (path, init) => { events.push(["stripe", path, init?.headers?.["Idempotency-Key"]]); return session(row); },
    logger: { error() {} }
  });
  const request = () => new Request("https://functions.example.com/checkout", { method: "POST", headers: { Origin: "https://app.example.com", Authorization: "Bearer token", "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ packageCode: "analysis_pack_10" }) });
  let response = await handler(request());
  assert.equal(response.status, 201);
  assert.deepEqual(events.map((event) => event[0]), ["order", "stripe", "link"]);
  assert.equal(events[0][1], `stripe:test:checkout:${key}`);
  assert.equal(events[1][2], orderId);
  created = false;
  events.length = 0;
  response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(events.map((event) => event[0]), ["order", "stripe"]);
});

test("handler rejects hostile origins and unauthenticated calls before side effects", async () => {
  let sideEffects = 0;
  const handler = checkout.createCheckoutHandler({
    loadConfig: () => ({ environment: "test", returnUrl: "https://app.example.com/", priceId }),
    authenticate: async () => { sideEffects += 1; return null; },
    createOrGetOrder: async () => { sideEffects += 1; }, stripeRequest: async () => { sideEffects += 1; },
    logger: { error() {} }
  });
  let response = await handler(new Request("https://functions.example.com/checkout", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  assert.equal(response.status, 403);
  assert.equal(sideEffects, 0);
  response = await handler(new Request("https://functions.example.com/checkout", { method: "POST", headers: { Origin: "https://app.example.com", "Content-Type": "application/json", "Idempotency-Key": key }, body: "{}" }));
  assert.equal(response.status, 401);
  assert.equal(sideEffects, 0);
});

test("order creation delegates account-scoped exclusion to the transactional RPC", async () => {
  const calls = [];
  const admin = { async rpc(name, args) { calls.push([name, args]); return { data: { created: false, order: order({ id: "existing-order" }) }, error: null }; } };
  const result = await checkout.createOrGetOrderRecord(admin, {
    userId: "user-1", idempotencyKey: `stripe:test:checkout:${key}`,
    offer: checkout.CHECKOUT_OFFER, environment: "test", priceId
  });
  assert.equal(result.created, false);
  assert.equal(result.order.id, "existing-order");
  assert.equal(calls[0][0], "create_or_get_stripe_checkout_order");
  assert.equal(calls[0][1].p_provider_price_id, priceId);
});

test("recovery uses the immutable order Price after the configured Price rotates", async () => {
  const oldPrice = "price_oldpack10";
  const newPrice = "price_newpack10";
  const existing = order({ provider_price_id: oldPrice, status: "payment_rejected" });
  let submittedPrice = null;
  const handler = checkout.createCheckoutHandler({
    loadConfig: () => ({ environment: "test", returnUrl: "https://app.example.com/", priceId: newPrice, allowedOrigins: "" }),
    authenticate: async () => ({ id: "user-1" }),
    createOrGetOrder: async () => ({ order: existing, created: false }),
    acquireRecoveryLease: async () => ({ ...existing, status: "creating_checkout" }),
    markCreationStatus: async () => true,
    linkSession: async (row, id) => ({ ...row, provider_checkout_session_id: id, status: "checkout_ready" }),
    stripeRequest: async (_path, init) => {
      submittedPrice = init.body.get("line_items[0][price]");
      return session(existing);
    },
    logger: { error() {} }
  });
  const response = await handler(new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: { Origin: "https://app.example.com", Authorization: "Bearer token", "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ packageCode: "analysis_pack_10" })
  }));
  assert.equal(response.status, 200);
  assert.equal(submittedPrice, oldPrice);
});

test("synchronous Stripe rejection is persisted and the exact retry reuses its order", async () => {
  let row = order();
  let created = true;
  let stripeAttempts = 0;
  const orderKeys = [];
  const stripeKeys = [];
  const handler = checkout.createCheckoutHandler({
    loadConfig: () => ({ environment: "test", returnUrl: "https://app.example.com/", priceId, allowedOrigins: "" }),
    authenticate: async () => ({ id: "user-1" }),
    createOrGetOrder: async ({ idempotencyKey }) => {
      orderKeys.push(idempotencyKey);
      return { order: row, created };
    },
    acquireRecoveryLease: async () => {
      row = { ...row, status: "creating_checkout" };
      return row;
    },
    markCreationStatus: async (_order, status) => {
      row = { ...row, status };
      return true;
    },
    linkSession: async (_order, id) => {
      row = { ...row, provider_checkout_session_id: id, status: "checkout_ready" };
      return row;
    },
    stripeRequest: async (_path, init) => {
      stripeAttempts += 1;
      stripeKeys.push(init.headers["Idempotency-Key"]);
      if (stripeAttempts === 1) throw new checkout.CheckoutHttpError(422, "stripe_rejected", "Stripe rejected checkout.");
      return session(row);
    },
    logger: { error() {} }
  });
  const checkoutRequest = () => new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: { Origin: "https://app.example.com", Authorization: "Bearer token", "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ packageCode: "analysis_pack_10" })
  });

  let response = await handler(checkoutRequest());
  assert.equal(response.status, 422);
  assert.equal(row.status, "payment_rejected");

  created = false;
  response = await handler(checkoutRequest());
  assert.equal(response.status, 200);
  assert.equal(row.status, "checkout_ready");
  assert.deepEqual(orderKeys, [`stripe:test:checkout:${key}`, `stripe:test:checkout:${key}`]);
  assert.deepEqual(stripeKeys, [orderId, orderId]);
});
