const test = require("node:test");
const assert = require("node:assert/strict");

function createStorage() {
  const values = new Map();
  let writes = 0;
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      values.set(key, value);
    },
    get writes() {
      return writes;
    }
  };
}

test("allows exactly two free analyses before requiring credits", async () => {
  const { consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.equal(getRemaining(readUsage(storage), 2), 2);
  consumeAnalysis(storage, 2);
  assert.equal(getRemaining(readUsage(storage), 2), 1);
  consumeAnalysis(storage, 2);
  assert.equal(getRemaining(readUsage(storage), 2), 0);
});

test("a purchased pack is consumed only after the free allowance", async () => {
  const { addCredits, consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  addCredits(storage, 10);
  assert.equal(getRemaining(readUsage(storage), 2), 12);

  consumeAnalysis(storage, 2);
  consumeAnalysis(storage, 2);
  assert.equal(readUsage(storage).credits, 10);

  consumeAnalysis(storage, 2);
  assert.equal(readUsage(storage).credits, 9);
  assert.equal(getRemaining(readUsage(storage), 2), 9);
});

test("credit packs accumulate and mark the browser as paid", async () => {
  const { addCredits, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  addCredits(storage, 10);
  addCredits(storage, 10);

  assert.deepEqual(readUsage(storage), {
    used: 0,
    credits: 20,
    paid: true,
    unlocked: false,
    appliedGrants: []
  });
});

test("a verified payment grant can only be credited once", async () => {
  const { applyCreditGrant, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.equal(applyCreditGrant(storage, "  payment-123  ", 10).applied, true);
  assert.equal(applyCreditGrant(storage, "payment-123", 10).applied, false);
  assert.equal(readUsage(storage).credits, 10);
  assert.deepEqual(readUsage(storage).appliedGrants, ["payment-123"]);
});

test("distinct verified grants accumulate credit packs", async () => {
  const { applyCreditGrant, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.equal(applyCreditGrant(storage, "payment-123", 10).applied, true);
  assert.equal(applyCreditGrant(storage, "payment-456", 10).applied, true);

  assert.equal(readUsage(storage).credits, 20);
  assert.deepEqual(readUsage(storage).appliedGrants, ["payment-123", "payment-456"]);
});

test("invalid payment grants are rejected without writing", async () => {
  const { applyCreditGrant } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.throws(() => applyCreditGrant(storage, "   ", 10), /obrigat.rio/);
  assert.throws(() => applyCreditGrant(storage, null, 10), /obrigat.rio/);
  assert.throws(() => applyCreditGrant(storage, "payment-123", 0), /inteiro positivo/);
  assert.throws(() => applyCreditGrant(storage, "payment-123", 1.5), /inteiro positivo/);
  assert.equal(storage.writes, 0);
});

test("free allowance, paid pack exhaustion and repurchase form one continuous balance", async () => {
  const {
    applyCreditGrant,
    consumeAnalysis,
    getRemaining,
    readUsage
  } = await import("../js/usage.mjs");
  const storage = createStorage();

  consumeAnalysis(storage, 2);
  consumeAnalysis(storage, 2);
  assert.equal(getRemaining(readUsage(storage), 2), 0);

  applyCreditGrant(storage, "purchase-1", 10);
  assert.equal(getRemaining(readUsage(storage), 2), 10);
  for (let index = 0; index < 10; index += 1) {
    consumeAnalysis(storage, 2);
  }
  assert.equal(getRemaining(readUsage(storage), 2), 0);
  assert.equal(readUsage(storage).credits, 0);

  applyCreditGrant(storage, "purchase-2", 10);
  assert.equal(getRemaining(readUsage(storage), 2), 10);
  assert.equal(readUsage(storage).credits, 10);
});

test("invalid credit quantities are rejected without writing", async () => {
  const { addCredits } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.throws(() => addCredits(storage, 0), /inteiro positivo/);
  assert.throws(() => addCredits(storage, 1.5), /inteiro positivo/);
  assert.equal(storage.writes, 0);
});

test("legacy beta unlock remains unlimited and retains paid benefits", async () => {
  const { consumeAnalysis, getHistoryLimit, getRemaining, readUsage, unlockBeta } = await import("../js/usage.mjs");
  const storage = createStorage();

  unlockBeta(storage);
  consumeAnalysis(storage, 2);

  const usage = readUsage(storage);
  assert.equal(usage.used, 0);
  assert.equal(getRemaining(usage, 2), Infinity);
  assert.equal(getHistoryLimit(usage, 3, 10), 10);
});

test("migrates the legacy v1 storage shape without losing unlimited access", async () => {
  const { consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();
  storage.setItem(
    "tx-raio-x:usage:v1",
    JSON.stringify({ used: 2, unlocked: true })
  );

  const usage = readUsage(storage);
  assert.deepEqual(usage, {
    used: 2,
    credits: 0,
    paid: true,
    unlocked: true,
    appliedGrants: []
  });
  consumeAnalysis(storage, 2);
  assert.equal(getRemaining(readUsage(storage), 2), Infinity);
  assert.equal(readUsage(storage).credits, 0);
});

test("the optional unlimited flag neither consumes usage nor writes", async () => {
  const { consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  consumeAnalysis(storage, 2, true);
  consumeAnalysis(storage, 2, true);

  assert.equal(readUsage(storage).used, 0);
  assert.equal(getRemaining(readUsage(storage), 2, true), Infinity);
  assert.equal(storage.writes, 0);
});

test("wallet history limit distinguishes free from paid use", async () => {
  const { getHistoryLimit } = await import("../js/usage.mjs");

  assert.equal(getHistoryLimit({ paid: false, unlocked: false }, 3, 10), 3);
  assert.equal(getHistoryLimit({ paid: true, unlocked: false }, 3, 10), 10);
  assert.equal(getHistoryLimit({ paid: false, unlocked: true }, 3, 10), 10);
});

test("corrupted storage falls back to a clean usage state", async () => {
  const { getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  storage.setItem("tx-raio-x:usage:v1", "{not-valid-json");

  assert.deepEqual(readUsage(storage), {
    used: 0,
    credits: 0,
    paid: false,
    unlocked: false,
    appliedGrants: []
  });
  assert.equal(getRemaining(readUsage(storage), 2), 2);
});
