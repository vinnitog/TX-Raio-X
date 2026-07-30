const test = require("node:test");
const assert = require("node:assert/strict");

const HASH = `0x${"a".repeat(64)}`;
const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

function rpcResponse(result) {
  return {
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result })
  };
}

test("reports total RPC unavailability clearly", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async () => {
    throw new Error("network unavailable");
  };

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /N.o foi poss.vel confirmar esse hash agora/
  );
});

test("reports not found only when every RPC for the selected network returns null", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    assert.equal(method, "eth_getTransactionByHash");
    return rpcResponse(null);
  };

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /hash n.o foi encontrado na rede escolhida/i
  );
});

test("does not report absence when one RPC returns null and another fails", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async (url) => {
    if (url === "https://cloudflare-eth.com") return rpcResponse(null);
    throw new Error("network unavailable");
  };

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /provedores RPC falharam/i
  );
});

test("falls back to the next Ethereum RPC after a null response", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };
  const calls = [];

  global.fetch = async (url, options) => {
    const { method } = JSON.parse(options.body);
    calls.push(`${url}:${method}`);
    if (url === "https://cloudflare-eth.com") return rpcResponse(null);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    if (method === "eth_getTransactionReceipt") return rpcResponse(receipt);
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(calls, [
    "https://cloudflare-eth.com:eth_getTransactionByHash",
    "https://ethereum-rpc.publicnode.com:eth_getTransactionByHash",
    "https://ethereum-rpc.publicnode.com:eth_getTransactionReceipt"
  ]);
  assert.equal(result.network.id, "ethereum");
  assert.deepEqual(result.transaction, transaction);
  assert.deepEqual(result.receipt, receipt);
});

test("uses a healthy RPC when another provider fails", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };

  global.fetch = async (url, options) => {
    if (url === "https://cloudflare-eth.com") throw new Error("offline");
    const { method } = JSON.parse(options.body);
    return method === "eth_getTransactionByHash"
      ? rpcResponse(transaction)
      : rpcResponse(receipt);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(result.transaction, transaction);
  assert.deepEqual(result.receipt, receipt);
});

test("tries another RPC when a provider has the transaction but not its receipt", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };

  global.fetch = async (url, options) => {
    const { method } = JSON.parse(options.body);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    return rpcResponse(url === "https://cloudflare-eth.com" ? null : receipt);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(result.receipt, receipt);
});

test("returns a pending transaction when every RPC still has no receipt", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };

  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    return method === "eth_getTransactionByHash"
      ? rpcResponse(transaction)
      : rpcResponse(null);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(result.transaction, transaction);
  assert.equal(result.receipt, null);
});

test("enriches a confirmed transaction with its block and confirmation height", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    blockNumber: "0x64",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };
  const block = { number: "0x64", timestamp: "0x66fc32d0" };

  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    if (method === "eth_getTransactionReceipt") return rpcResponse(receipt);
    if (method === "eth_getBlockByNumber") return rpcResponse(block);
    if (method === "eth_blockNumber") return rpcResponse("0x68");
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(result.block, block);
  assert.equal(result.latestBlockNumber, "0x68");
});

test("keeps valid block context when the latest height is temporarily unavailable", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    blockNumber: "0x64",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };
  const block = { number: "0x64", timestamp: "0x66fc32d0" };

  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    if (method === "eth_getTransactionReceipt") return rpcResponse(receipt);
    if (method === "eth_getBlockByNumber") return rpcResponse(block);
    if (method === "eth_blockNumber") throw new Error("temporarily unavailable");
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.deepEqual(result.block, block);
  assert.equal(result.latestBlockNumber, undefined);
});

test("rejects block context that does not match the receipt block", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    blockNumber: "0x64",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };

  global.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    if (method === "eth_getTransactionReceipt") return rpcResponse(receipt);
    if (method === "eth_getBlockByNumber") {
      return rpcResponse({ number: "0x63", timestamp: "0x66fc32d0" });
    }
    if (method === "eth_blockNumber") return rpcResponse("0x68");
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  const result = await findTransaction(HASH, "ethereum");

  assert.equal(result.block, undefined);
  assert.equal(result.latestBlockNumber, "0x68");
});

test("treats malformed JSON-RPC success payloads as inconclusive failures", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1 })
  });

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /provedores RPC falharam/i
  );
});

test("rejects JSON-RPC responses with a mismatched request id", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 2, result: null })
  });

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /provedores RPC falharam/i
  );
});

test("rejects transaction objects missing fields required by the analyzer", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  global.fetch = async () => rpcResponse({ hash: HASH });

  await assert.rejects(
    findTransaction(HASH, "ethereum"),
    /provedores RPC falharam/i
  );
});

test("returns a transaction found on one network despite failures on others", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };

  global.fetch = async (url, options) => {
    if (url !== "https://mainnet.base.org") {
      throw new Error("network unavailable");
    }

    const { method, params } = JSON.parse(options.body);
    assert.deepEqual(params, [HASH]);
    if (method === "eth_getTransactionByHash") return rpcResponse(transaction);
    if (method === "eth_getTransactionReceipt") return rpcResponse(receipt);
    throw new Error(`Unexpected RPC method: ${method}`);
  };

  const result = await findTransaction(HASH);

  assert.equal(result.network.id, "base");
  assert.deepEqual(result.transaction, transaction);
  assert.deepEqual(result.receipt, receipt);
});

test("automatic detection cancels slower networks after one network wins", async () => {
  const { findTransaction } = await import("../js/chain-client.mjs");
  const transaction = {
    hash: HASH,
    from: `0x${"1".repeat(40)}`,
    to: `0x${"2".repeat(40)}`,
    value: "0x0",
    gasPrice: "0x1",
    input: "0x"
  };
  const receipt = {
    transactionHash: HASH,
    status: "0x1",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    logs: []
  };
  let abortedRequests = 0;

  global.fetch = async (url, options) => {
    if (url === "https://mainnet.base.org") {
      const { method } = JSON.parse(options.body);
      return method === "eth_getTransactionByHash"
        ? rpcResponse(transaction)
        : rpcResponse(receipt);
    }

    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        abortedRequests += 1;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  };

  const result = await findTransaction(HASH);
  await Promise.resolve();

  assert.equal(result.network.id, "base");
  assert.ok(abortedRequests > 0);
});
