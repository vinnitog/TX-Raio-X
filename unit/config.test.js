const test = require("node:test");
const assert = require("node:assert/strict");

test("local demo mode is restricted to loopback hosts", async () => {
  const { isLocalTestEnvironment } = await import("../js/config.mjs");

  for (const address of [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://[::1]:4173"
  ]) {
    assert.equal(isLocalTestEnvironment(new URL(address).hostname), true);
  }

  for (const address of [
    "https://txraiox.com.br",
    "https://localhost.example.com",
    "http://192.168.0.10"
  ]) {
    assert.equal(isLocalTestEnvironment(new URL(address).hostname), false);
  }
});

test("every network has RPC endpoints and Ethereum has a tested fallback", async () => {
  const { NETWORKS } = await import("../js/config.mjs");
  const ethereum = NETWORKS.find(({ id }) => id === "ethereum");

  for (const network of NETWORKS) {
    assert.ok(Array.isArray(network.rpcUrls) && network.rpcUrls.length > 0);
  }
  assert.deepEqual(ethereum.rpcUrls, [
    "https://cloudflare-eth.com",
    "https://ethereum-rpc.publicnode.com"
  ]);
});

test("the active offer is configured as one pack below five reais", async () => {
  const { CREDIT_PACK_PRICE, CREDIT_PACK_SIZE, FREE_ANALYSES } = await import("../js/config.mjs");

  assert.equal(FREE_ANALYSES, 2);
  assert.equal(CREDIT_PACK_SIZE, 10);
  assert.equal(CREDIT_PACK_PRICE, 4.9);
});
