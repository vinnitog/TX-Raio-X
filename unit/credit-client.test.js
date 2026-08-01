const test = require("node:test");
const assert = require("node:assert/strict");

const analysisId = "10000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values
  };
}

function createClient({ userId = "user-1", rpc, invoke } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        getSession: async () => ({
          data: { session: userId ? { user: { id: userId } } : null },
          error: null
        })
      },
      rpc: async (name) => {
        calls.push({ type: "rpc", name });
        return rpc ? rpc(name) : {
          data: [{ balance: "10", has_paid_access: true }],
          error: null
        };
      },
      functions: {
        invoke: async (name, options) => {
          calls.push({ type: "function", name, options });
          return invoke ? invoke(name, options) : {
            data: { consumed: true, applied: true, balance: 9 },
            error: null
          };
        }
      }
    }
  };
}

test("credit balance belongs to the authenticated Supabase account", async () => {
  const { createCreditClient } = await import("../js/credit-client.mjs");
  const mock = createClient({ userId: "account-a" });
  const entitlement = await createCreditClient(mock.client).getEntitlement();

  assert.deepEqual(entitlement, {
    userId: "account-a",
    balance: 10,
    hasPaidAccess: true
  });
  assert.deepEqual(mock.calls, [{ type: "rpc", name: "get_credit_entitlement" }]);
});

test("guest cannot load or consume account credits", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const mock = createClient({ userId: null });
  const client = createCreditClient(mock.client, { createId: () => analysisId });

  await assert.rejects(client.getEntitlement(), (error) =>
    error instanceof CreditClientError && error.code === "authentication_required");
  await assert.rejects(client.consume(analysisId), { code: "authentication_required" });
  assert.equal(mock.calls.length, 0);
});

test("consumption sends only a generated UUID and validates the response", async () => {
  const { createCreditClient } = await import("../js/credit-client.mjs");
  const mock = createClient();
  const client = createCreditClient(mock.client, {
    createId: () => analysisId,
    storage: createStorage()
  });

  assert.equal(client.prepareAnalysis("user-1", fingerprint), analysisId);
  assert.deepEqual(await client.consume(analysisId, "user-1"), { balance: 9, applied: true });
  assert.deepEqual(mock.calls[0], {
    type: "function",
    name: "consume-analysis",
    options: { body: { analysisId } }
  });
});

test("function error codes are preserved without exposing response details", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const mock = createClient({
    invoke: async () => ({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "credits_exhausted", detail: "private" })) }
    })
  });

  await assert.rejects(createCreditClient(mock.client).consume(analysisId), (error) =>
    error instanceof CreditClientError
      && error.code === "credits_exhausted"
      && !error.message.includes("private"));
});

test("uncertain consumption retries once with the same analysis identifier", async () => {
  const { createCreditClient } = await import("../js/credit-client.mjs");
  let attempts = 0;
  const mock = createClient({
    invoke: async (_name, options) => {
      attempts += 1;
      assert.deepEqual(options, { body: { analysisId } });
      return attempts === 1
        ? { data: null, error: new TypeError("response lost") }
        : { data: { consumed: true, applied: false, balance: 9 }, error: null };
    }
  });

  assert.deepEqual(await createCreditClient(mock.client).consume(analysisId, "user-1"), {
    balance: 9,
    applied: false
  });
  assert.equal(attempts, 2);
});

test("two uncertain responses remain pending and the same analysis is recovered after reload", async () => {
  const { createCreditClient } = await import("../js/credit-client.mjs");
  const storage = createStorage();
  const uncertain = createClient({
    invoke: async (_name, options) => {
      assert.deepEqual(options, { body: { analysisId } });
      return { data: null, error: new TypeError("response lost") };
    }
  });
  const first = createCreditClient(uncertain.client, {
    storage,
    createId: () => analysisId
  });
  assert.equal(first.prepareAnalysis("user-1", fingerprint), analysisId);
  await assert.rejects(first.consume(analysisId, "user-1"), { code: "credits_unavailable" });
  assert.equal(uncertain.calls.filter(({ type }) => type === "function").length, 2);

  const afterReload = createCreditClient(createClient().client, {
    storage,
    createId: () => assert.fail("an uncertain persisted attempt must not rotate its UUID")
  });
  assert.equal(afterReload.prepareAnalysis("user-1", fingerprint), analysisId);
});

test("malformed balances and identifiers fail closed", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const malformed = createClient({
    rpc: async () => ({ data: [{ balance: -1, has_paid_access: true }], error: null })
  });
  await assert.rejects(createCreditClient(malformed.client).getEntitlement(), {
    code: "invalid_entitlement_response"
  });
  assert.throws(
    () => createCreditClient(malformed.client, {
      createId: () => "invalid",
      storage: createStorage()
    }).prepareAnalysis("user-1", fingerprint),
    (error) => error instanceof CreditClientError && error.code === "idempotency_unavailable"
  );
});

test("pending consumption survives reload and blocks a different analysis", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const storage = createStorage();
  const first = createCreditClient(createClient().client, {
    createId: () => analysisId,
    storage
  });
  assert.equal(first.prepareAnalysis("user-1", fingerprint), analysisId);

  const afterReload = createCreditClient(createClient().client, {
    createId: () => assert.fail("pending UUID must be reused"),
    storage
  });
  assert.equal(afterReload.prepareAnalysis("user-1", fingerprint), analysisId);
  assert.throws(
    () => afterReload.prepareAnalysis("user-1", "b".repeat(64)),
    (error) => error instanceof CreditClientError
      && error.code === "consumption_reconciliation_required"
  );
});

test("account switch is rejected before invoking financial consumption", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const mock = createClient({ userId: "user-b" });
  await assert.rejects(
    createCreditClient(mock.client).consume(analysisId, "user-a"),
    (error) => error instanceof CreditClientError && error.code === "account_changed"
  );
  assert.equal(mock.calls.length, 0);
});

test("account switch after the balance query still cannot invoke consumption for the frozen account", async () => {
  const { createCreditClient } = await import("../js/credit-client.mjs");
  let currentUserId = "user-a";
  let invokeCalls = 0;
  const client = createCreditClient({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: currentUserId } } },
        error: null
      })
    },
    rpc: async () => ({
      data: [{ balance: "10", has_paid_access: true }],
      error: null
    }),
    functions: {
      invoke: async () => {
        invokeCalls += 1;
        return { data: { consumed: true, applied: true, balance: 9 }, error: null };
      }
    }
  });

  const entitlement = await client.getEntitlement();
  assert.equal(entitlement.userId, "user-a");
  currentUserId = "user-b";
  await assert.rejects(client.consume(analysisId, entitlement.userId), { code: "account_changed" });
  assert.equal(invokeCalls, 0);
});

test("paid consumption fails closed when pending idempotency cannot be persisted", async () => {
  const { CreditClientError, createCreditClient } = await import("../js/credit-client.mjs");
  const blockedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const client = createCreditClient(createClient().client, {
    createId: () => analysisId,
    storage: blockedStorage
  });
  assert.throws(
    () => client.prepareAnalysis("user-1", fingerprint),
    (error) => error instanceof CreditClientError
      && error.code === "idempotency_persistence_unavailable"
  );
});

test("analysis fingerprint is deterministic without persisting the transaction hash", async () => {
  const { fingerprintAnalysis } = await import("../js/credit-client.mjs");
  const hash = `0x${"ab".repeat(32)}`;
  const first = await fingerprintAnalysis(hash, "ethereum");
  const second = await fingerprintAnalysis(hash.toUpperCase().replace("0X", "0x"), "ETHEREUM");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, hash.slice(2));
});
