const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

let {
  CHECKOUT_OFFER,
  CheckoutHttpError,
  buildPreferencePayload,
  createCheckoutHandler,
  createOrGetOrderRecord,
  findPreferenceByExternalReference,
  getAllowedOrigins,
  getCheckoutUrl,
  getCorsHeaders,
  isCheckoutRecoveryDue,
  validateCheckoutConfig,
  validatePreferenceSnapshot,
  validateCheckoutRequest
} = {};

test.before(async () => {
  ({
    CHECKOUT_OFFER,
    CheckoutHttpError,
    buildPreferencePayload,
    createCheckoutHandler,
    createOrGetOrderRecord,
    findPreferenceByExternalReference,
    getAllowedOrigins,
    getCheckoutUrl,
    getCorsHeaders,
    isCheckoutRecoveryDue,
    validateCheckoutConfig,
    validatePreferenceSnapshot,
    validateCheckoutRequest
  } = await import("../supabase/functions/_shared/checkout.mjs"));
});

const validKey = "018e2f16-2e2a-4b88-a231-2bda2696f741";

test("checkout accepts only the configured package and a UUID v4 idempotency key", () => {
  assert.deepEqual(validateCheckoutRequest({ packageCode: "analysis_pack_10" }, validKey), {
    ok: true,
    idempotencyKey: validKey
  });
  assert.equal(validateCheckoutRequest({ packageCode: "other" }, validKey).code, "invalid_package");
  assert.equal(validateCheckoutRequest({ packageCode: "analysis_pack_10" }, "retry-1").code, "invalid_idempotency_key");
});

test("the server owns the complete commercial snapshot", () => {
  assert.deepEqual(CHECKOUT_OFFER, {
    code: "analysis_pack_10",
    credits: 10,
    amountCents: 490,
    currency: "BRL",
    title: "Tx Raio-X — pacote com 10 análises"
  });

  const payload = buildPreferencePayload(
    "35ca9da5-e3ca-417f-a240-2d75d6855e17",
    "https://example.com/app?source=checkout",
    "https://project.supabase.co/functions/v1/mercado-pago-webhook"
  );
  assert.equal(payload.items[0].unit_price, 4.9);
  assert.equal(payload.items[0].quantity, 1);
  assert.equal(payload.items[0].currency_id, "BRL");
  assert.equal(payload.external_reference, "35ca9da5-e3ca-417f-a240-2d75d6855e17");
  assert.equal(payload.notification_url, "https://project.supabase.co/functions/v1/mercado-pago-webhook");
  assert.match(payload.back_urls.success, /source=checkout&checkout_status=success$/);
  assert.match(payload.back_urls.pending, /source=checkout&checkout_status=pending$/);
  assert.match(payload.back_urls.failure, /source=checkout&checkout_status=failure$/);
  assert.deepEqual(payload.payment_methods, {
    excluded_payment_types: [{ id: "ticket" }],
    installments: 1,
    default_installments: 1
  });
});

test("checkout stays locked to test mode and HTTPS callbacks", () => {
  const base = {
    environment: "test",
    returnUrl: "https://example.com/",
    webhookUrl: "https://project.supabase.co/functions/v1/mercado-pago-webhook"
  };
  assert.doesNotThrow(() => validateCheckoutConfig(base));
  assert.throws(() => validateCheckoutConfig({ ...base, environment: "production" }), /production is disabled/i);
  assert.throws(() => validateCheckoutConfig({ ...base, returnUrl: "http://localhost:4173" }), /HTTPS/);
});

test("test mode returns only the sandbox checkout URL", () => {
  const preference = {
    init_point: "https://www.mercadopago.com/checkout/production",
    sandbox_init_point: "https://sandbox.mercadopago.com/checkout/test"
  };
  assert.equal(getCheckoutUrl(preference, "test"), preference.sandbox_init_point);
  assert.throws(() => getCheckoutUrl({ init_point: preference.init_point }, "test"), /valid checkout URL/);
});

test("preference recovery requires the matching commercial snapshot", () => {
  const order = {
    id: "35ca9da5-e3ca-417f-a240-2d75d6855e17",
    package_code: "analysis_pack_10",
    amount_cents: 490,
    currency: "BRL"
  };
  const preference = {
    id: "preference-1",
    external_reference: order.id,
    items: [{ id: order.package_code, quantity: 1, currency_id: "BRL", unit_price: 4.9 }],
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }],
      installments: 1,
      default_installments: 1
    }
  };

  assert.equal(validatePreferenceSnapshot(preference, order), preference);
  assert.throws(
    () => validatePreferenceSnapshot({ ...preference, external_reference: "another-order" }, order),
    /does not match/
  );
  assert.throws(
    () => validatePreferenceSnapshot({ ...preference, items: [{ ...preference.items[0], unit_price: 0.49 }] }, order),
    /does not match/
  );
  assert.throws(
    () => validatePreferenceSnapshot({ ...preference, items: [...preference.items, { ...preference.items[0] }] }, order),
    /does not match/
  );
  assert.throws(
    () => validatePreferenceSnapshot({
      ...preference,
      payment_methods: { ...preference.payment_methods, default_installments: 2 }
    }, order),
    /does not match/
  );
  assert.equal(findPreferenceByExternalReference({ elements: [preference] }, order.id), preference);
  assert.equal(findPreferenceByExternalReference({ elements: [] }, order.id), null);
});

test("an uncertain checkout receives a recovery lease only after five minutes", () => {
  const updatedAt = "2026-07-31T12:00:00.000Z";
  assert.equal(isCheckoutRecoveryDue(updatedAt, Date.parse("2026-07-31T12:04:59.999Z")), false);
  assert.equal(isCheckoutRecoveryDue(updatedAt, Date.parse("2026-07-31T12:05:00.000Z")), true);
  assert.equal(isCheckoutRecoveryDue("invalid", Date.now()), false);
});

test("CORS allows only configured origins", () => {
  const allowed = getAllowedOrigins("https://example.com/app", "https://admin.example.com");
  const headers = getCorsHeaders("https://example.com", allowed);
  assert.equal(allowed.has("https://example.com"), true);
  assert.equal(allowed.has("https://admin.example.com"), true);
  assert.equal(getCorsHeaders("https://evil.example", allowed)["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers["Access-Control-Allow-Origin"], "https://example.com");
  assert.deepEqual(
    headers["Access-Control-Allow-Headers"].split(",").map((header) => header.trim()),
    ["authorization", "x-client-info", "apikey", "content-type", "idempotency-key"]
  );
  assert.equal(headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assert.equal(headers.Vary, "Origin");
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
  assert.doesNotMatch(headers["Access-Control-Allow-Headers"], /\*/);
});

test("CORS origin matching is exact and never expands to lookalikes", () => {
  const allowed = getAllowedOrigins("https://app.example.com/return", "https://admin.example.com");
  for (const origin of [
    "https://app.example.com.evil.test",
    "https://sub.app.example.com",
    "http://app.example.com",
    "https://app.example.com:444",
    "https://app.example.com."
  ]) {
    assert.equal(getCorsHeaders(origin, allowed)["Access-Control-Allow-Origin"], undefined, origin);
  }
  assert.equal(
    getCorsHeaders("https://admin.example.com", allowed)["Access-Control-Allow-Origin"],
    "https://admin.example.com"
  );
});

test("Edge Function delegates HTTP behavior to the testable handler", async () => {
  const source = await readFile("supabase/functions/checkout/index.ts", "utf8");
  const shared = await readFile("supabase/functions/_shared/checkout.mjs", "utf8");
  assert.match(source, /Deno\.serve\(createCheckoutHandler\(/);
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /provider_preference_id: preferenceId/);
  assert.match(source, /createOrGetOrderRecord\(getSupabaseAdmin\(\), args, ORDER_FIELDS\)/);
  assert.match(shared, /package_credits: offer\.credits/);
  assert.match(shared, /onConflict: "idempotency_key", ignoreDuplicates: true/);
  assert.doesNotMatch(shared, /insertError\?\.code === "23505"/);
});

function orderStore({ insertedOrder = null, insertError = null, existingOrder = null, existingError = null } = {}) {
  const calls = [];
  const selectExisting = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    async maybeSingle() {
      calls.push(["existing.maybeSingle"]);
      return { data: existingOrder, error: existingError };
    }
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return {
          upsert(values, options) {
            calls.push(["upsert", values, options]);
            return {
              select(fields) {
                calls.push(["insert.select", fields]);
                return {
                  async maybeSingle() {
                    calls.push(["insert.maybeSingle"]);
                    return { data: insertedOrder, error: insertError };
                  }
                };
              }
            };
          },
          select(fields) {
            calls.push(["existing.select", fields]);
            return selectExisting;
          }
        };
      }
    }
  };
}

test("order store inserts once and recovers a duplicate without a database error", async () => {
  const args = {
    userId: "user-1",
    idempotencyKey: "checkout:key-1",
    offer: CHECKOUT_OFFER
  };
  const fields = "id, status";
  const created = { id: "order-1", status: "creating_preference" };
  const first = orderStore({ insertedOrder: created });
  assert.deepEqual(await createOrGetOrderRecord(first.client, args, fields), {
    order: created,
    created: true
  });
  assert.equal(first.calls.some(([name]) => name === "existing.select"), false);
  assert.deepEqual(first.calls.find(([name]) => name === "upsert")[2], {
    onConflict: "idempotency_key",
    ignoreDuplicates: true
  });

  const retry = orderStore({ existingOrder: created });
  assert.deepEqual(await createOrGetOrderRecord(retry.client, args, fields), {
    order: created,
    created: false
  });
  assert.deepEqual(retry.calls.filter(([name]) => name === "eq"), [
    ["eq", "user_id", "user-1"],
    ["eq", "idempotency_key", "checkout:key-1"]
  ]);
});

test("order store propagates insert and recovery errors", async () => {
  const args = { userId: "user-1", idempotencyKey: "checkout:key-1", offer: CHECKOUT_OFFER };
  const insertError = new Error("insert unavailable");
  await assert.rejects(createOrGetOrderRecord(
    orderStore({ insertError }).client,
    args,
    "id"
  ), insertError);

  const existingError = new Error("read unavailable");
  await assert.rejects(createOrGetOrderRecord(
    orderStore({ existingError }).client,
    args,
    "id"
  ), existingError);
});

test("order store exposes account erasure conflict without leaking database details", async () => {
  const args = { userId: "user-1", idempotencyKey: "checkout:key-1", offer: CHECKOUT_OFFER };
  await assert.rejects(
    createOrGetOrderRecord(
      orderStore({ insertError: { message: "account_erasure_in_progress", details: "private" } }).client,
      args,
      "id"
    ),
    (error) => error instanceof CheckoutHttpError
      && error.status === 409
      && error.code === "account_erasure_in_progress"
  );
});

test("Supabase delegates JWT verification to the authenticated checkout handler", async () => {
  const config = await readFile("supabase/config.toml", "utf8");
  const handler = await readFile("supabase/functions/_shared/checkout.mjs", "utf8");
  const index = await readFile("supabase/functions/checkout/index.ts", "utf8");
  assert.match(config, /\[functions\.checkout\]\s+verify_jwt = false/);
  assert.match(handler, /Authorization/);
  assert.match(handler, /if \(!token\)/);
  assert.match(handler, /await authenticate\(token\)/);
  assert.match(index, /auth\.getUser\(token\)/);
});

function checkoutRequest({
  method = "POST",
  origin = "https://app.example.com",
  token = "valid-token",
  key = validKey,
  body = { packageCode: CHECKOUT_OFFER.code }
} = {}) {
  const headers = { Origin: origin };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (key !== null) headers["Idempotency-Key"] = key;
  if (body !== null) headers["Content-Type"] = "application/json";
  return new Request("https://functions.example.com/checkout", {
    method,
    headers,
    body: method === "POST" && body !== null ? JSON.stringify(body) : undefined
  });
}

function preferenceFor(order, overrides = {}) {
  return {
    id: "pref-1",
    external_reference: order.id,
    items: [{
      id: order.package_code,
      quantity: 1,
      currency_id: order.currency,
      unit_price: order.amount_cents / 100
    }],
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }],
      installments: 1,
      default_installments: 1
    },
    sandbox_init_point: "https://sandbox.mercadopago.com/checkout/pref-1",
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const events = [];
  const providerRequests = [];
  const orders = new Map();
  let sequence = 0;
  const logger = { error: () => {} };
  const config = {
    environment: "test",
    returnUrl: "https://app.example.com/checkout-return",
    webhookUrl: "https://project.supabase.co/functions/v1/mercado-pago-webhook",
    allowedOrigins: "https://admin.example.com"
  };

  const dependencies = {
    loadConfig: () => ({ ...config, ...overrides.config }),
    authenticate: async (token) => {
      events.push(`auth:${token}`);
      return token === "valid-token" ? { id: "user-1" } : null;
    },
    createOrGetOrder: async ({ userId, idempotencyKey, offer }) => {
      const mapKey = `${userId}:${idempotencyKey}`;
      events.push("order");
      if (orders.has(mapKey)) return { order: orders.get(mapKey), created: false };
      const order = {
        id: `order-${++sequence}`,
        provider_preference_id: null,
        status: "creating_preference",
        package_code: offer.code,
        amount_cents: offer.amountCents,
        currency: offer.currency,
        updated_at: "2026-07-31T12:00:00.000Z"
      };
      orders.set(mapKey, order);
      return { order, created: true };
    },
    acquireRecoveryLease: async (order) => {
      events.push("lease");
      order.status = "creating_preference";
      order.updated_at = "2026-07-31T12:05:00.000Z";
      return order;
    },
    markCreationStatus: async (order, status) => {
      events.push(`mark:${status}`);
      order.status = status;
      return true;
    },
    linkPreference: async (order, preferenceId) => {
      events.push("link");
      order.provider_preference_id = preferenceId;
      order.status = "checkout_ready";
      return order;
    },
    mercadoPagoRequest: async (path, init) => {
      providerRequests.push({ path, init });
      const operation = init?.method === "POST" ? "preference:create" : `preference:get:${path}`;
      events.push(operation);
      const order = [...orders.values()][0];
      if (path.includes("/search?")) return { elements: [] };
      return preferenceFor(order);
    },
    now: () => Date.parse("2026-07-31T12:00:00.000Z"),
    logger,
    ...overrides.dependencies
  };

  return { handler: createCheckoutHandler(dependencies), events, orders, providerRequests, dependencies };
}

async function responseBody(response) {
  return { response, body: await response.json() };
}

test("behavior: Supabase client preflight is allowed without side effects and an unknown origin is rejected", async () => {
  const harness = createHarness();
  const preflightRequest = checkoutRequest({ method: "OPTIONS", token: null, key: null, body: null });
  preflightRequest.headers.set(
    "Access-Control-Request-Headers",
    "authorization,apikey,content-type,idempotency-key,x-client-info"
  );
  preflightRequest.headers.set("Access-Control-Request-Method", "POST");
  const preflight = await harness.handler(preflightRequest);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  assert.equal(
    preflight.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type, idempotency-key"
  );
  assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(preflight.headers.get("Vary"), "Origin");
  assert.deepEqual(harness.events, []);

  const rejectedPreflight = checkoutRequest({
    method: "OPTIONS",
    origin: "https://app.example.com.evil.test",
    token: null,
    key: null,
    body: null
  });
  rejectedPreflight.headers.set("Access-Control-Request-Method", "POST");
  rejectedPreflight.headers.set("Access-Control-Request-Headers", "x-client-info,authorization");
  const { response, body } = await responseBody(await harness.handler(rejectedPreflight));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(body.error, "origin_not_allowed");
  assert.deepEqual(harness.events, []);
});

test("behavior: authentication and input are validated before database/provider side effects", async () => {
  const harness = createHarness();
  let result = await responseBody(await harness.handler(checkoutRequest({ token: null })));
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "authentication_required");

  result = await responseBody(await harness.handler(checkoutRequest({ body: { packageCode: "forged" } })));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "invalid_package");
  assert.deepEqual(harness.events, ["auth:valid-token"]);

  result = await responseBody(await harness.handler(checkoutRequest({ token: "expired" })));
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "invalid_session");
  assert.deepEqual(harness.events, ["auth:valid-token", "auth:expired"]);
  assert.equal(harness.orders.size, 0);
  assert.equal(harness.providerRequests.length, 0);
});

test("behavior: malformed JSON and non-object bodies fail closed before side effects", async () => {
  const harness = createHarness();
  const headers = {
    Origin: "https://app.example.com",
    Authorization: "Bearer valid-token",
    "Content-Type": "application/json",
    "Idempotency-Key": validKey
  };
  const malformed = new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers,
    body: "{not-json"
  });
  let result = await responseBody(await harness.handler(malformed));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "invalid_package");

  for (const body of [[], "analysis_pack_10", 490, true]) {
    result = await responseBody(await harness.handler(checkoutRequest({ body })));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, "invalid_package");
  }
  assert.deepEqual(harness.events, Array(5).fill("auth:valid-token"));
  assert.equal(harness.orders.size, 0);
  assert.equal(harness.providerRequests.length, 0);
});

test("behavior: authentication precedes media type and body parsing", async () => {
  const harness = createHarness();
  const baseHeaders = {
    Origin: "https://app.example.com",
    "Content-Type": "text/plain",
    "Idempotency-Key": validKey
  };
  let request = new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: baseHeaders,
    body: "{not-json"
  });
  let result = await responseBody(await harness.handler(request));
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "authentication_required");
  assert.deepEqual(harness.events, []);

  request = new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: { ...baseHeaders, Authorization: "Bearer expired" },
    body: "{not-json"
  });
  result = await responseBody(await harness.handler(request));
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "invalid_session");
  assert.deepEqual(harness.events, ["auth:expired"]);
});

test("behavior: checkout accepts only application/json bodies up to 4096 bytes", async () => {
  const harness = createHarness();
  const headers = {
    Origin: "https://app.example.com",
    Authorization: "Bearer valid-token",
    "Idempotency-Key": validKey
  };
  let request = new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/plain" },
    body: JSON.stringify({ packageCode: "analysis_pack_10" })
  });
  let result = await responseBody(await harness.handler(request));
  assert.equal(result.response.status, 415);
  assert.equal(result.body.error, "unsupported_media_type");

  request = new Request("https://functions.example.com/checkout", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ packageCode: "analysis_pack_10", padding: "x".repeat(4097) })
  });
  result = await responseBody(await harness.handler(request));
  assert.equal(result.response.status, 413);
  assert.equal(result.body.error, "request_too_large");
  assert.deepEqual(harness.events, ["auth:valid-token", "auth:valid-token"]);
  assert.equal(harness.orders.size, 0);
  assert.equal(harness.providerRequests.length, 0);
});

test("behavior: unsupported methods and preflight bodies are side-effect free with bounded CORS", async () => {
  const harness = createHarness();
  let result = await responseBody(await harness.handler(checkoutRequest({ method: "PUT", body: null })));
  assert.equal(result.response.status, 405);
  assert.equal(result.body.error, "method_not_allowed");
  assert.equal(result.response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");

  const preflight = new Request("https://functions.example.com/checkout", {
    method: "OPTIONS",
    headers: { Origin: "https://app.example.com", "Content-Type": "text/plain" },
    body: "unexpected"
  });
  const response = await harness.handler(preflight);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  assert.deepEqual(harness.events, []);
});

test("behavior: injected financial fields cannot override the server-owned order snapshot", async () => {
  const harness = createHarness();
  const result = await responseBody(await harness.handler(checkoutRequest({
    body: {
      packageCode: "analysis_pack_10",
      amountCents: 1,
      credits: 999999,
      currency: "USD",
      userId: "attacker-user",
      returnUrl: "https://evil.example/paid"
    }
  })));
  assert.equal(result.response.status, 201);
  const order = [...harness.orders.values()][0];
  assert.deepEqual(
    [order.package_code, order.amount_cents, order.currency],
    ["analysis_pack_10", 490, "BRL"]
  );
  assert.equal(harness.orders.has(`user-1:checkout:${validKey}`), true);
  assert.equal(harness.orders.has(`attacker-user:checkout:${validKey}`), false);
  const payload = JSON.parse(harness.providerRequests[0].init.body);
  assert.equal(payload.items[0].unit_price, 4.9);
  assert.equal(new URL(payload.back_urls.success).origin, "https://app.example.com");
});

test("behavior: order snapshot is persisted before preference creation and success", async () => {
  const harness = createHarness();
  const { response, body } = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(response.status, 201);
  assert.equal(body.orderId, "order-1");
  assert.equal(body.environment, "test");
  assert.equal(body.checkoutUrl, "https://sandbox.mercadopago.com/checkout/pref-1");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(harness.events, ["auth:valid-token", "order", "preference:create", "link"]);
  assert.equal(harness.providerRequests[0].init.headers["X-Idempotency-Key"], "order-1");
  const providerPayload = JSON.parse(harness.providerRequests[0].init.body);
  assert.equal(providerPayload.external_reference, "order-1");
  const order = [...harness.orders.values()][0];
  assert.deepEqual(
    [order.package_code, order.amount_cents, order.currency, order.status],
    ["analysis_pack_10", 490, "BRL", "checkout_ready"]
  );
});

test("behavior: repeated idempotency key reuses the linked preference without a second creation", async () => {
  const harness = createHarness();
  const first = await harness.handler(checkoutRequest());
  const second = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(first.status, 201);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(harness.events.filter((event) => event === "preference:create").length, 1);
  assert.equal(harness.events.filter((event) => event.startsWith("preference:get:")).length, 1);
});

test("behavior: concurrent retry observes in-progress state and never creates a second preference", async () => {
  let releaseCreation;
  const creationGate = new Promise((resolve) => { releaseCreation = resolve; });
  const harness = createHarness({
    dependencies: {
      mercadoPagoRequest: async (path, init) => {
        if (init?.method === "POST") {
          harness.events.push("preference:create");
          await creationGate;
          return preferenceFor([...harness.orders.values()][0]);
        }
        harness.events.push(`preference:get:${path}`);
        return { elements: [] };
      }
    }
  });
  const firstPromise = harness.handler(checkoutRequest());
  await new Promise((resolve) => setImmediate(resolve));
  const second = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(second.response.status, 409);
  assert.equal(second.body.error, "checkout_in_progress");
  releaseCreation();
  assert.equal((await firstPromise).status, 201);
  assert.equal(harness.events.filter((event) => event === "preference:create").length, 1);
});

test("behavior: definitive provider rejection marks failed and can be retried immediately", async () => {
  let createAttempts = 0;
  const harness = createHarness({
    dependencies: {
      mercadoPagoRequest: async (path, init) => {
        if (path.includes("/search?")) return { elements: [] };
        if (init?.method === "POST" && ++createAttempts === 1) {
          throw new CheckoutHttpError(502, "mercado_pago_rejected", "bad request");
        }
        return preferenceFor([...harness.orders.values()][0]);
      }
    }
  });
  const first = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(first.body.error, "mercado_pago_rejected");
  assert.equal([...harness.orders.values()][0].status, "preference_failed");
  const second = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(second.response.status, 200);
  assert.equal(second.body.reused, true);
  assert.equal(createAttempts, 2);
});

test("behavior: unknown provider outcome is not recreated before reconciliation delay", async () => {
  const harness = createHarness({
    dependencies: {
      mercadoPagoRequest: async (path, init) => {
        if (path.includes("/search?")) return { elements: [] };
        if (init?.method === "POST") {
          throw new CheckoutHttpError(502, "mercado_pago_result_unknown", "timeout");
        }
        throw new Error("unexpected provider call");
      }
    }
  });
  const first = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(first.body.error, "mercado_pago_result_unknown");
  assert.equal([...harness.orders.values()][0].status, "preference_unknown");
  const second = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(second.response.status, 409);
  assert.equal(second.body.error, "checkout_in_progress");
});

test("behavior: stale unknown outcome requires and acquires a compare-and-set recovery lease", async () => {
  let creates = 0;
  const harness = createHarness({
    dependencies: {
      now: () => Date.parse("2026-07-31T12:05:00.000Z"),
      mercadoPagoRequest: async (path, init) => {
        if (path.includes("/search?")) return { elements: [] };
        if (init?.method === "POST") {
          creates += 1;
          return preferenceFor([...harness.orders.values()][0]);
        }
        throw new Error("unexpected provider call");
      }
    }
  });
  const order = {
    id: "order-stale",
    provider_preference_id: null,
    status: "preference_unknown",
    package_code: CHECKOUT_OFFER.code,
    amount_cents: 490,
    currency: "BRL",
    updated_at: "2026-07-31T12:00:00.000Z"
  };
  harness.orders.set(`user-1:checkout:${validKey}`, order);
  const result = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.reused, true);
  assert.equal(creates, 1);
  assert.equal(harness.events.includes("lease"), true);
});

test("behavior: recovered preference must match the immutable order snapshot", async () => {
  const harness = createHarness({
    dependencies: {
      mercadoPagoRequest: async (path) => {
        const order = [...harness.orders.values()][0];
        if (path.includes("/search?")) {
          return { elements: [preferenceFor(order, {
            items: [{ id: order.package_code, quantity: 1, currency_id: "BRL", unit_price: 49 }]
          })] };
        }
        throw new Error("unexpected provider call");
      }
    }
  });
  harness.orders.set(`user-1:checkout:${validKey}`, {
    id: "order-existing",
    provider_preference_id: null,
    status: "preference_unknown",
    package_code: CHECKOUT_OFFER.code,
    amount_cents: 490,
    currency: "BRL",
    updated_at: "2026-07-31T12:00:00.000Z"
  });
  const result = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(result.response.status, 500);
  assert.equal(result.body.error, "internal_error");
  assert.equal(harness.events.includes("link"), false);
});

test("behavior: zero-row critical updates force reconciliation instead of reporting success", async () => {
  let harness = createHarness({ dependencies: { linkPreference: async () => null } });
  let result = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, "checkout_reconciliation_required");

  harness = createHarness({
    dependencies: {
      markCreationStatus: async () => false,
      mercadoPagoRequest: async () => {
        throw new CheckoutHttpError(502, "mercado_pago_result_unknown", "timeout");
      }
    }
  });
  result = await responseBody(await harness.handler(checkoutRequest()));
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, "checkout_reconciliation_required");
});
