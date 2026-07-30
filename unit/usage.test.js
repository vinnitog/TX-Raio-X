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

test("allows exactly two free analyses", async () => {
  const { consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  assert.equal(getRemaining(readUsage(storage), 2), 2);
  consumeAnalysis(storage);
  assert.equal(getRemaining(readUsage(storage), 2), 1);
  consumeAnalysis(storage);
  assert.equal(getRemaining(readUsage(storage), 2), 0);
});

test("beta unlock makes the remaining allowance unlimited", async () => {
  const { consumeAnalysis, getRemaining, readUsage, unlockBeta } = await import("../js/usage.mjs");
  const storage = createStorage();

  unlockBeta(storage);
  consumeAnalysis(storage);
  consumeAnalysis(storage);

  assert.equal(readUsage(storage).used, 0);
  assert.equal(getRemaining(readUsage(storage), 2), Infinity);
});

test("the optional unlimited flag neither consumes usage nor reaches the paywall", async () => {
  const { consumeAnalysis, getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  consumeAnalysis(storage, true);
  consumeAnalysis(storage, true);

  assert.equal(readUsage(storage).used, 0);
  assert.equal(getRemaining(readUsage(storage), 2, true), Infinity);
  assert.equal(storage.writes, 0);
});

test("wallet history limit distinguishes free use from unlocked beta", async () => {
  const { getHistoryLimit } = await import("../js/usage.mjs");

  assert.equal(getHistoryLimit({ unlocked: false }, 3, 10), 3);
  assert.equal(getHistoryLimit({ unlocked: true }, 3, 10), 10);
});

test("corrupted storage falls back to a clean usage state", async () => {
  const { getRemaining, readUsage } = await import("../js/usage.mjs");
  const storage = createStorage();

  storage.setItem("tx-raio-x:usage:v1", "{not-valid-json");

  assert.deepEqual(readUsage(storage), { used: 0, unlocked: false });
  assert.equal(getRemaining(readUsage(storage), 2), 2);
});
