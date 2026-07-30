const test = require("node:test");
const assert = require("node:assert/strict");

test("validates an EVM transaction hash", async () => {
  const { isTransactionHash } = await import("../js/analyzer.mjs");
  assert.equal(isTransactionHash(`0x${"a".repeat(64)}`), true);
  assert.equal(isTransactionHash("0x1234"), false);
  assert.equal(isTransactionHash(`0x${"z".repeat(64)}`), false);
});

test("explains unlimited approvals and never claims funds moved", async () => {
  const { createDemoAnalysis } = await import("../js/analyzer.mjs");
  const result = createDemoAnalysis();

  assert.equal(result.title, "Uma autorização foi concedida");
  assert.match(result.summary, /não significa que os tokens já saíram/i);
  assert.ok(result.alerts.some((alert) => /ilimitada/i.test(alert.title)));
});

test("explains a failed transaction and its fee risk", async () => {
  const { analyzeTransaction } = await import("../js/analyzer.mjs");
  const result = analyzeTransaction({
    network: { name: "Base", nativeSymbol: "ETH", explorerUrl: "https://example.com/" },
    transaction: {
      hash: `0x${"2".repeat(64)}`,
      from: `0x${"1".repeat(40)}`,
      to: `0x${"2".repeat(40)}`,
      value: "0x0",
      gasPrice: "0x3b9aca00",
      input: "0x"
    },
    receipt: {
      status: "0x0",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
      logs: []
    }
  });

  assert.equal(result.status.label, "Falhou");
  assert.equal(result.title, "A transação falhou");
  assert.ok(result.alerts.some((alert) => /taxa/i.test(alert.text)));
});

test("never claims a failed approval was granted", async () => {
  const { analyzeTransaction } = await import("../js/analyzer.mjs");
  const result = analyzeTransaction({
    network: { name: "Base", nativeSymbol: "ETH", explorerUrl: "https://example.com/" },
    transaction: {
      hash: `0x${"3".repeat(64)}`,
      from: `0x${"1".repeat(40)}`,
      to: `0x${"2".repeat(40)}`,
      value: "0x0",
      gasPrice: "0x1",
      input: `0x095ea7b3${"0".repeat(64)}${"f".repeat(64)}`
    },
    receipt: {
      status: "0x0",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      logs: []
    }
  });

  assert.equal(result.title, "A transação falhou");
  assert.equal(result.alerts.some((alert) => /autorização praticamente ilimitada/i.test(alert.title)), false);
  assert.equal(result.alerts.some((alert) => /permissão ativa/i.test(alert.text)), false);
});

test("builds a detailed Raio-X with block context, calldata and receipt movements", async () => {
  const { analyzeTransaction } = await import("../js/analyzer.mjs");
  const owner = `0x${"1".repeat(40)}`;
  const spender = `0x${"2".repeat(40)}`;
  const token = `0x${"3".repeat(40)}`;
  const approvalTopic = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
  const result = analyzeTransaction({
    network: { name: "Ethereum", nativeSymbol: "ETH", explorerUrl: "https://example.com/" },
    transaction: {
      hash: `0x${"4".repeat(64)}`,
      from: owner,
      to: token,
      value: "0x0",
      gas: "0x186a0",
      gasPrice: "0x3b9aca00",
      nonce: "0x2",
      type: "0x2",
      input: `0x095ea7b3${"0".repeat(24)}${spender.slice(2)}${"0".repeat(63)}a`
    },
    receipt: {
      status: "0x1",
      blockNumber: "0x64",
      transactionIndex: "0x1",
      gasUsed: "0x5208",
      cumulativeGasUsed: "0x10410",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: [{
        address: token,
        topics: [
          approvalTopic,
          `0x${"0".repeat(24)}${owner.slice(2)}`,
          `0x${"0".repeat(24)}${spender.slice(2)}`
        ],
        data: `0x${"0".repeat(63)}a`
      }]
    },
    block: { number: "0x64", timestamp: "0x66fc32d0" },
    latestBlockNumber: "0x68"
  });

  assert.equal(result.details.find(({ label }) => label === "Confirmações").value, "5");
  assert.equal(result.details.find(({ label }) => label === "De").value, owner);
  assert.equal(result.decodedFields.find(({ label }) => /Contrato autorizado/.test(label)).value, spender);
  assert.equal(result.movements.length, 1);
  assert.match(result.movements[0].type, /Permissão de token/i);
  assert.equal(result.technicalDetails.find(({ label }) => label === "Nonce").value, "2");
});

test("describes an ERC-721 approval by token id instead of a fungible amount", async () => {
  const { analyzeTransaction } = await import("../js/analyzer.mjs");
  const owner = `0x${"1".repeat(40)}`;
  const approved = `0x${"2".repeat(40)}`;
  const token = `0x${"3".repeat(40)}`;
  const result = analyzeTransaction({
    network: { name: "Ethereum", nativeSymbol: "ETH", explorerUrl: "https://example.com/" },
    transaction: {
      hash: `0x${"5".repeat(64)}`,
      from: owner,
      to: token,
      value: "0x0",
      gas: "0x186a0",
      gasPrice: "0x1",
      input: `0x095ea7b3${"0".repeat(24)}${approved.slice(2)}${"0".repeat(63)}7`
    },
    receipt: {
      status: "0x1",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      logs: [{
        address: token,
        topics: [
          "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
          `0x${"0".repeat(24)}${owner.slice(2)}`,
          `0x${"0".repeat(24)}${approved.slice(2)}`,
          `0x${"0".repeat(63)}7`
        ],
        data: "0x"
      }]
    }
  });

  assert.equal(result.movements.length, 1);
  assert.match(result.movements[0].type, /NFT \(ERC-721\)/);
  assert.equal(result.movements[0].summary, "Token ID 7");
  assert.equal(
    result.decodedFields.find(({ label }) => label === "Token ID solicitado").value,
    "7"
  );
  assert.ok(result.alerts.some(({ title }) => /Autorização de NFT/.test(title)));
  assert.equal(result.alerts.some(({ title }) => /ilimitada/i.test(title)), false);
});

test("does not expose a negative confirmation count from inconsistent heights", async () => {
  const { analyzeTransaction } = await import("../js/analyzer.mjs");
  const result = analyzeTransaction({
    network: { name: "Ethereum", nativeSymbol: "ETH", explorerUrl: "https://example.com/" },
    transaction: {
      hash: `0x${"6".repeat(64)}`,
      from: `0x${"1".repeat(40)}`,
      to: `0x${"2".repeat(40)}`,
      value: "0x0",
      gas: "0x5208",
      gasPrice: "0x1",
      input: "0x"
    },
    receipt: {
      status: "0x1",
      blockNumber: "0x65",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      logs: []
    },
    latestBlockNumber: "0x64"
  });

  assert.equal(result.details.find(({ label }) => label === "Confirmações").value, "—");
});
