const test = require("node:test");
const assert = require("node:assert/strict");

const idOne = "018e2f16-2e2a-4b88-a231-2bda2696f741";
const idTwo = "15c946b8-6403-4fb4-848f-2f064936d9d8";
const legacyKey = "txraiox_checkout_attempt_v1";
const attemptsKey = "txraiox_checkout_attempts_v2";

function uuidFor(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

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

function createSupabase({ userId = "user-1", invoke, orderStatus = null, orderError = null } = {}) {
  const calls = [];
  const orderChecks = [];
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
              checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_default",
              environment: "test"
            },
            error: null
          };
        }
      },
      from: (table) => ({
        select: () => ({
          eq(field, value) {
            orderChecks.push({ table, field, value });
            return this;
          },
          maybeSingle: async () => ({
            data: orderStatus ? { status: orderStatus } : null,
            error: orderError
          })
        })
      })
    },
    calls,
    orderChecks
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

test("a valid v1 attempt migrates to v2 and is reused", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(legacyKey, JSON.stringify({ userId: "user-1", idempotencyKey: idOne }));
  const supabase = createSupabase();

  await createCheckoutClient(supabase.client, {
    storage,
    createId: () => assert.fail("valid v1 must be reused")
  }).start();

  assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
    { userId: "user-1", idempotencyKey: idOne }
  ]);
  assert.equal(storage.values.has(legacyKey), false, "v1 must be removed after the v2 copy succeeds");
});

test("failed v1 cleanup keeps the migrated key unchanged", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(legacyKey, JSON.stringify({ userId: "user-1", idempotencyKey: idOne }));
  storage.removeItem = () => { throw new Error("cleanup blocked"); };
  const supabase = createSupabase();
  const client = createCheckoutClient(supabase.client, {
    storage,
    createId: () => assert.fail("cleanup failure must not replace the migrated key")
  });

  await client.start();
  await client.start();
  assert.deepEqual(
    supabase.calls.map(({ options }) => options.headers["Idempotency-Key"]),
    [idOne, idOne]
  );
  assert.equal(storage.values.has(legacyKey), true);
  assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
    { userId: "user-1", idempotencyKey: idOne }
  ]);
});

test("v1 is not removed when the v2 write fails", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  let removeCalls = 0;
  storage.values.set(legacyKey, JSON.stringify({ userId: "user-1", idempotencyKey: idOne }));
  storage.setItem = () => { throw new Error("write blocked"); };
  storage.removeItem = () => { removeCalls += 1; };
  const supabase = createSupabase();

  await createCheckoutClient(supabase.client, {
    storage,
    createId: () => assert.fail("valid v1 must still be used")
  }).start();
  assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.equal(removeCalls, 0);
  assert.equal(storage.values.has(legacyKey), true);
});

test("v1 for A does not leak to B and remains recoverable when A returns", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(legacyKey, JSON.stringify({ userId: "user-a", idempotencyKey: idOne }));
  const accountB = createSupabase({ userId: "user-b" });
  await createCheckoutClient(accountB.client, { storage, createId: () => idTwo }).start();
  assert.equal(accountB.calls[0].options.headers["Idempotency-Key"], idTwo);

  const accountA = createSupabase({ userId: "user-a" });
  await createCheckoutClient(accountA.client, {
    storage,
    createId: () => assert.fail("A must recover its v1 attempt")
  }).start();
  assert.equal(accountA.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
    { userId: "user-b", idempotencyKey: idTwo },
    { userId: "user-a", idempotencyKey: idOne }
  ]);
});

test("invalid or corrupted v1 data is ignored safely", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  for (const legacy of ["{broken", JSON.stringify({ userId: "user-1", idempotencyKey: "not-a-uuid" })]) {
    const storage = createStorage();
    storage.values.set(legacyKey, legacy);
    const supabase = createSupabase();
    await createCheckoutClient(supabase.client, { storage, createId: () => idTwo }).start();
    assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idTwo);
    assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
      { userId: "user-1", idempotencyKey: idTwo }
    ]);
  }
});

test("partially invalid v2 data preserves valid attempts and drops invalid entries on write", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(attemptsKey, JSON.stringify([
    { userId: "user-a", idempotencyKey: idOne },
    { userId: "", idempotencyKey: idTwo },
    { userId: "user-invalid", idempotencyKey: "broken" },
    { userId: "user-b", idempotencyKey: idTwo }
  ]));
  const accountA = createSupabase({ userId: "user-a" });
  await createCheckoutClient(accountA.client, {
    storage,
    createId: () => assert.fail("valid A entry must survive")
  }).start();
  assert.equal(accountA.calls[0].options.headers["Idempotency-Key"], idOne);

  const accountC = createSupabase({ userId: "user-c" });
  await createCheckoutClient(accountC.client, { storage, createId: () => uuidFor(3) }).start();
  assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
    { userId: "user-b", idempotencyKey: idTwo },
    { userId: "user-a", idempotencyKey: idOne },
    { userId: "user-c", idempotencyKey: uuidFor(3) }
  ]);
});

test("v2 takes precedence over v1 for the same account", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(legacyKey, JSON.stringify({ userId: "user-1", idempotencyKey: idOne }));
  storage.values.set(attemptsKey, JSON.stringify([{ userId: "user-1", idempotencyKey: idTwo }]));
  const supabase = createSupabase();
  await createCheckoutClient(supabase.client, {
    storage,
    createId: () => assert.fail("v2 must take precedence")
  }).start();
  assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idTwo);
});

test("the last valid duplicate v2 attempt wins", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(attemptsKey, JSON.stringify([
    { userId: "user-1", idempotencyKey: idOne },
    { userId: "user-1", idempotencyKey: "invalid" },
    { userId: "user-1", idempotencyKey: idTwo }
  ]));
  const supabase = createSupabase();
  await createCheckoutClient(supabase.client, {
    storage,
    createId: () => assert.fail("last valid duplicate must be reused")
  }).start();
  assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idTwo);
  assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
    { userId: "user-1", idempotencyKey: idTwo }
  ]);
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

test("checkout A -> B -> A preserves A's unresolved idempotency key", async () => {
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
    createId: () => assert.fail("A must reuse its unresolved key")
  }).start());

  assert.equal(accountAFirst.calls[0].options.headers["Idempotency-Key"], idOne);
  assert.equal(accountB.calls[0].options.headers["Idempotency-Key"], idTwo);
  assert.equal(accountASecond.calls[0].options.headers["Idempotency-Key"], idOne);
});

test("checkout rejects production or untrusted redirect responses", async () => {
  const { CheckoutClientError, createCheckoutClient } = await import("../js/checkout-client.mjs");
  for (const response of [
    { orderId: "order-1", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_live_123", environment: "production" },
    { orderId: "order-1", checkoutUrl: "https://evil.example/checkout", environment: "test" },
    { orderId: "order-1", checkoutUrl: "https://checkout.stripe.com.evil.example/checkout", environment: "test" }
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

test("checkout accepts the exact Stripe Checkout host", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const supabase = createSupabase({
    invoke: async () => ({
      data: {
        orderId: "order-stripe",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_checkout",
        environment: "test"
      },
      error: null
    })
  });
  const result = await createCheckoutClient(supabase.client, {
    storage: createStorage(),
    createId: () => idOne
  }).start();

  assert.equal(result.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_checkout");
});

test("every terminal checkout status rotates its key so the same account can repurchase", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  for (const orderStatus of [
    "payment_approved", "payment_cancelled", "payment_charged_back",
    "payment_refunded", "payment_rejected"
  ]) {
    const storage = createStorage();
    storage.values.set(attemptsKey, JSON.stringify([
      { userId: "user-1", idempotencyKey: idOne }
    ]));
    const supabase = createSupabase({ orderStatus });
    await createCheckoutClient(supabase.client, { storage, createId: () => idTwo }).start();
    assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idTwo, orderStatus);
    assert.deepEqual(JSON.parse(storage.values.get(attemptsKey)), [
      { userId: "user-1", idempotencyKey: idTwo }
    ]);
  }
});

test("unresolved or unavailable order state preserves the retry key", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  for (const options of [
    { orderStatus: "checkout_ready" },
    { orderStatus: "payment_pending" },
    { orderError: new Error("offline") }
  ]) {
    const storage = createStorage();
    storage.values.set(attemptsKey, JSON.stringify([
      { userId: "user-1", idempotencyKey: idOne }
    ]));
    const supabase = createSupabase(options);
    await createCheckoutClient(supabase.client, {
      storage,
      createId: () => assert.fail("unresolved key must be preserved")
    }).start();
    assert.equal(supabase.calls[0].options.headers["Idempotency-Key"], idOne);
  }
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

test("blocked storage preserves A -> B -> A attempts in one client instance", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  let currentUserId = "user-a";
  const calls = [];
  const client = createCheckoutClient({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: currentUserId } } },
        error: null
      })
    },
    functions: {
      invoke: async (_name, options) => {
        calls.push({ userId: currentUserId, key: options.headers["Idempotency-Key"] });
        return { data: null, error: new Error("offline") };
      }
    }
  }, {
    storage: createStorage({ blocked: true }),
    createId: () => currentUserId === "user-a" ? idOne : idTwo
  });

  await assert.rejects(client.start());
  currentUserId = "user-b";
  await assert.rejects(client.start());
  currentUserId = "user-a";
  await assert.rejects(client.start());
  assert.deepEqual(calls, [
    { userId: "user-a", key: idOne },
    { userId: "user-b", key: idTwo },
    { userId: "user-a", key: idOne }
  ]);
});

test("v2 storage does not silently evict unresolved account attempts", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const storage = createStorage();
  storage.values.set(attemptsKey, JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
    userId: `user-${index + 1}`,
    idempotencyKey: uuidFor(index + 1)
  }))));
  const eleventh = createSupabase({ userId: "user-11" });
  await createCheckoutClient(eleventh.client, {
    storage,
    createId: () => uuidFor(11)
  }).start();

  const attempts = JSON.parse(storage.values.get(attemptsKey));
  assert.equal(attempts.length, 11);
  assert.deepEqual(attempts.map(({ userId }) => userId), [
    "user-1", "user-2", "user-3", "user-4", "user-5", "user-6",
    "user-7", "user-8", "user-9", "user-10", "user-11"
  ]);
});

test("an in-memory attempt is persisted when blocked storage recovers", async () => {
  const { createCheckoutClient } = await import("../js/checkout-client.mjs");
  const values = new Map();
  let blocked = true;
  const storage = {
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
    }
  };
  const supabase = createSupabase({
    invoke: async () => ({ data: null, error: new Error("offline") })
  });
  const client = createCheckoutClient(supabase.client, { storage, createId: () => idOne });
  await assert.rejects(client.start());
  assert.equal(values.has(attemptsKey), false);

  blocked = false;
  await assert.rejects(client.start());
  assert.deepEqual(JSON.parse(values.get(attemptsKey)), [
    { userId: "user-1", idempotencyKey: idOne }
  ]);
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
