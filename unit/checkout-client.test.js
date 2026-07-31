const test = require("node:test");
const assert = require("node:assert/strict");

const idOne = "018e2f16-2e2a-4b88-a231-2bda2696f741";
const idTwo = "15c946b8-6403-4fb4-848f-2f064936d9d8";
const idThree = "28aa9940-55ea-49a7-84a3-4509f8998877";

function createStorage({ blocked = false } = {}) {
  const values = new Map();
  return {
    getItem(key) {
      if (blocked) throw new Error("blocked");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error("blocked");
      values.set(key, value);
    },
    removeItem(key) {
      if (blocked) throw new Error("blocked");
      values.delete(key);
    },
    values
  };
}

function createSupabase({ userId = "user-1", invoke } = {}) {
  const calls = [];
  return {
    client: {
      auth: {
        getSession: async () => ({
          data: { session: userId ? { user: { id: userId } } : null },
          error: null
        })
      },
      functions: {
        invoke: async (name, options) => {
          calls.push({ name, options });
          if (invoke) return invoke(name, options, calls.length);
          return {
            data: {
              orderId: "order-1",
              checkoutUrl: "https://sandbox.mercadopago.com/checkout/pref-1",
              environment: "test"
            },
            error: null
          };
        }
      }
    },
    calls
  };
}

test("checkout requires an authenticated Supabase session before invoking the function", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const supabase = createSupabase({ userId: null });
  const result = await createCheckoutClient(supabase.client, {
    storage: createStorage(),
    createId: () => idOne
  }).start();

  assert.deepEqual(result, { status: "auth_required" });
  assert.equal(supabase.calls.length, 0);
});

test("checkout sends only package code and a UUID idempotency header", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  const supabase = createSupabase();
  const result = await createCheckoutClient(supabase.client, {
    storage,
    createId: () => idOne
  }).start();

  assert.equal(result.status, "ready");
  assert.equal(result.orderId, "order-1");
  assert.equal(supabase.calls.length, 1);
  assert.deepEqual(supabase.calls[0], {
    name: "checkout",
    options: {
      body: { packageCode: "analysis_pack_10" },
      headers: { "Idempotency-Key": idOne }
    }
  });
  assert.equal(storage.values.size, 1, "checkout should preserve its retry key until server-side resolution");
  await createCheckoutClient(supabase.client, {
    storage,
    createId: () => idTwo
  }).start();
  assert.equal(supabase.calls[1].options.headers["Idempotency-Key"], idOne);
});

test("failed retries reuse the same key for the same account", async () => {
  const { CheckoutClientError, createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  const supabase = createSupabase({
    invoke: async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "checkout_in_progress" })) }
    })
  });
  const client = createCheckoutClient(supabase.client, { storage, createId: () => idOne });

  await assert.rejects(client.start(), (error) => {
    assert.ok(error instanceof CheckoutClientError);
    return error.code === "checkout_in_progress";
  });
  await assert.rejects(client.start(), { code: "checkout_in_progress" });
  assert.deepEqual(
    supabase.calls.map(({ options }) => options.headers["Idempotency-Key"]),
    [idOne, idOne]
  );
});

test("a different authenticated account never inherits another user's retry key", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  const first = createSupabase({
    userId: "user-1",
    invoke: async () => ({ data: null, error: new Error("offline") })
  });
  await assert.rejects(
    createCheckoutClient(first.client, { storage, createId: () => idOne }).start()
  );

  const second = createSupabase({ userId: "user-2" });
  await createCheckoutClient(second.client, { storage, createId: () => idTwo }).start();
  assert.equal(second.calls[0].options.headers["Idempotency-Key"], idTwo);
});

test("audit reproduction: checkout A -> B -> A currently replaces A's unresolved key", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  const reject = async () => ({ data: null, error: new Error("offline") });
  const accountAFirst = createSupabase({ userId: "user-a", invoke: reject });
  const accountB = createSupabase({ userId: "user-b", invoke: reject });
  const accountASecond = createSupabase({ userId: "user-a", invoke: reject });

  await assert.rejects(createCheckoutClient(accountAFirst.client, {
    storage,
    createId: () => idOne
  }).start());
  await assert.rejects(createCheckoutClient(accountB.client, {
    storage,
    createId: () => idTwo
  }).start());
  await assert.rejects(createCheckoutClient(accountASecond.client, {
    storage,
    createId: () => idThree
  }).start());

  assert.equal(accountAFirst.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.equal(accountB.calls[0].options.headers["Idempotency-Key"], idTwo);
  assert.equal(accountASecond.calls[0].options.headers["Idempotency-Key"], idThree);
  assert.notEqual(accountASecond.calls[0].options.headers["Idempotency-Key"], idOne);
});

test.todo("checkout A -> B -> A preserves A's unresolved idempotency key");

test("checkout rejects production or non-sandbox redirect responses", async () => {
  const { CheckoutClientError, createCheckoutClient } = await import("../js/checkout-client.mjs");
  for (const response of [
    { orderId: "order-1", checkoutUrl: "https://www.mercadopago.com/checkout", environment: "production" },
    { orderId: "order-1", checkoutUrl: "https://evil.example/checkout", environment: "test" },
    { orderId: "order-1", checkoutUrl: "https://sandbox.mercadopago.evil.example/checkout", environment: "test" }
  ]) {
    const supabase = createSupabase({ invoke: async () => ({ data: response, error: null }) });
    await assert.rejects(
      createCheckoutClient(supabase.client, {
        storage: createStorage(),
        createId: () => idOne
      }).start(),
      (error) => error instanceof CheckoutClientError && error.code === "invalid_checkout_response"
    );
  }
});

test("checkout accepts the Brazilian Mercado Pago sandbox host", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const supabase = createSupabase({
    invoke: async () => ({
      data: {
        orderId: "order-br",
        checkoutUrl: "https://sandbox.mercadopago.com.br/checkout/pref-br",
        environment: "test"
      },
      error: null
    })
  });
  const result = await createCheckoutClient(supabase.client, {
    storage: createStorage(),
    createId: () => idOne
  }).start();

  assert.equal(result.checkoutUrl, "https://sandbox.mercadopago.com.br/checkout/pref-br");
});

test("blocked sessionStorage still reuses an in-memory attempt", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const supabase = createSupabase({
    invoke: async () => ({ data: null, error: new Error("offline") })
  });
  const client = createCheckoutClient(supabase.client, {
    storage: createStorage({ blocked: true }),
    createId: () => idOne
  });
  await assert.rejects(client.start());
  await assert.rejects(client.start());
  assert.deepEqual(
    supabase.calls.map(({ options }) => options.headers["Idempotency-Key"]),
    [idOne, idOne]
  );
});

test("audit reproduction: blocked storage plus reload currently replaces the unresolved key", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage({ blocked: true });
  const first = createSupabase({ invoke: async () => ({ data: null, error: new Error("offline") }) });
  await assert.rejects(createCheckoutClient(first.client, {
    storage,
    createId: () => idOne
  }).start());

  const afterReload = createSupabase({ invoke: async () => ({ data: null, error: new Error("offline") }) });
  await assert.rejects(createCheckoutClient(afterReload.client, {
    storage,
    createId: () => idTwo
  }).start());
  assert.equal(first.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.equal(afterReload.calls[0].options.headers["Idempotency-Key"], idTwo);
  assert.notEqual(afterReload.calls[0].options.headers["Idempotency-Key"], idOne);
});

test.todo("blocked storage preserves an unresolved attempt after reload");
