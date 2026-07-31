const test = require("node:test");
const assert = require("node:assert/strict");

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}

test("validates EVM public wallet addresses", async () => {
  const { isWalletAddress } = await import("../js/history-client.mjs");

  assert.equal(isWalletAddress(`0x${"a".repeat(40)}`), true);
  assert.equal(isWalletAddress(`0x${"a".repeat(39)}`), false);
  assert.equal(isWalletAddress(`0x${"z".repeat(40)}`), false);
});

test("sorts the displayed transactions without mutating the search result", async () => {
  const { sortTransactions } = await import("../js/history-client.mjs");
  const transactions = [
    { hash: "older", timestamp: 100 },
    { hash: "newer", timestamp: 200 }
  ];

  assert.deepEqual(
    sortTransactions(transactions, "desc").map(({ hash }) => hash),
    ["newer", "older"]
  );
  assert.deepEqual(
    sortTransactions(transactions, "asc").map(({ hash }) => hash),
    ["older", "newer"]
  );
  assert.deepEqual(transactions.map(({ hash }) => hash), ["older", "newer"]);
});

test("merges, sorts and deduplicates histories from responding networks", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  const olderHash = `0x${"1".repeat(64)}`;
  const newerHash = `0x${"2".repeat(64)}`;

  const fetchMock = async (url) => {
    if (url.hostname === "arbitrum.blockscout.com") throw new Error("offline");
    if (url.hostname === "eth.blockscout.com") {
      return jsonResponse({
        status: "1",
        message: "OK",
        result: [
          { hash: olderHash, from: address, timeStamp: "100", isError: "0", functionName: "approve(address,uint256)" }
        ]
      });
    }
    if (url.hostname === "base.blockscout.com") {
      return jsonResponse({
        status: "1",
        message: "OK",
        result: [
          { hash: newerHash, from: `0x${"b".repeat(40)}`, timeStamp: "200", isError: "0", functionName: "transfer(address,uint256)" },
          { hash: olderHash, from: address, timeStamp: "100", isError: "0", functionName: "" }
        ]
      });
    }
    return jsonResponse({ status: "0", message: "No transactions found", result: [] });
  };

  const result = await findRecentTransactions(address, "auto", 8, fetchMock);

  assert.deepEqual(
    result.transactions.map((transaction) => `${transaction.networkId}:${transaction.hash}`),
    [`base:${newerHash}`, `ethereum:${olderHash}`, `base:${olderHash}`]
  );
  assert.equal(result.transactions[0].direction, "Recebida");
  assert.equal(result.transactions[1].direction, "Enviada");
  assert.equal(result.failedNetworks, 1);
  assert.deepEqual(result.failedNetworkNames, ["Arbitrum"]);
  assert.equal(result.searchedNetworks, 4);
});

test("applies the wallet history limit globally after merging compatible networks", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  const timestampsByHost = {
    "eth.blockscout.com": 100,
    "base.blockscout.com": 400,
    "arbitrum.blockscout.com": 300,
    "polygon.blockscout.com": 200
  };

  const fetchMock = async (url) => {
    const timestamp = timestampsByHost[url.hostname];
    return jsonResponse({
      status: "1",
      message: "OK",
      result: [{
        hash: `0x${String(timestamp / 100).repeat(64)}`,
        from: address,
        timeStamp: String(timestamp),
        isError: "0",
        functionName: ""
      }]
    });
  };

  const result = await findRecentTransactions(address, "auto", 3, fetchMock);

  assert.deepEqual(
    result.transactions.map(({ networkId }) => networkId),
    ["base", "arbitrum", "polygon"]
  );
  assert.equal(result.transactions.length, 3);
  assert.equal(result.searchedNetworks, 4);
});

test("applies the paid history limit of ten only after merging all networks", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const { getHistoryLimit } = await import("../js/usage.mjs");
  const address = `0x${"a".repeat(40)}`;
  const timestampsByHost = {
    "eth.blockscout.com": [120, 80, 40],
    "base.blockscout.com": [110, 70, 30],
    "arbitrum.blockscout.com": [100, 60, 20],
    "polygon.blockscout.com": [90, 50, 10]
  };
  const requestedOffsets = [];
  const paidLimit = getHistoryLimit({ paid: true, unlocked: false }, 3, 10);

  const fetchMock = async (url) => {
    requestedOffsets.push(url.searchParams.get("offset"));
    return jsonResponse({
      status: "1",
      message: "OK",
      result: timestampsByHost[url.hostname].map((timestamp) => ({
        hash: `0x${timestamp.toString(16).padStart(64, "0")}`,
        from: address,
        timeStamp: String(timestamp),
        isError: "0",
        functionName: ""
      }))
    });
  };

  const result = await findRecentTransactions(address, "auto", paidLimit, fetchMock);

  assert.equal(paidLimit, 10);
  assert.deepEqual(requestedOffsets, ["10", "10", "10", "10"]);
  assert.deepEqual(
    result.transactions.map(({ timestamp }) => timestamp),
    [120, 110, 100, 90, 80, 70, 60, 50, 40, 30]
  );
});

test("automatic wallet search queries each indexed host once and never queries BNB", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const requestedHosts = [];
  const fetchMock = async (url) => {
    requestedHosts.push(url.hostname);
    return jsonResponse({ status: "0", message: "No transactions found", result: [] });
  };

  const result = await findRecentTransactions(
    `0x${"a".repeat(40)}`,
    "auto",
    3,
    fetchMock
  );

  assert.deepEqual(requestedHosts, [
    "eth.blockscout.com",
    "base.blockscout.com",
    "arbitrum.blockscout.com",
    "polygon.blockscout.com"
  ]);
  assert.equal(new Set(requestedHosts).size, 4);
  assert.equal(result.searchedNetworks, 4);
});

test("deduplicates repeated hashes within the same network", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  const repeatedHash = `0x${"f".repeat(64)}`;
  const fetchMock = async () =>
    jsonResponse({
      status: "1",
      message: "OK",
      result: [
        { hash: repeatedHash, from: address, timeStamp: "100", isError: "0", functionName: "" },
        { hash: repeatedHash, from: address, timeStamp: "200", isError: "0", functionName: "" }
      ]
    });

  const result = await findRecentTransactions(address, "ethereum", 3, fetchMock);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].hash, repeatedHash);
  assert.equal(result.transactions[0].timestamp, 200);
});

test("returns an empty result when a network responds with no transactions", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const fetchMock = async () =>
    jsonResponse({ status: "0", message: "No transactions found", result: [] });

  const result = await findRecentTransactions(`0x${"a".repeat(40)}`, "base", 8, fetchMock);

  assert.deepEqual(result.transactions, []);
  assert.equal(result.failedNetworks, 0);
  assert.deepEqual(result.failedNetworkNames, []);
});

test("requests the newest Blockscout transactions with the wallet address and limit", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  let requestedUrl;
  const fetchMock = async (url) => {
    requestedUrl = url;
    return jsonResponse({ status: "0", message: "No transactions found", result: [] });
  };

  await findRecentTransactions(address, "base", 5, fetchMock);

  assert.equal(requestedUrl.searchParams.get("module"), "account");
  assert.equal(requestedUrl.searchParams.get("action"), "txlist");
  assert.equal(requestedUrl.searchParams.get("address"), address);
  assert.equal(requestedUrl.searchParams.get("offset"), "5");
  assert.equal(requestedUrl.searchParams.get("sort"), "desc");
});

test("defaults free wallet history searches to the latest three transactions", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  let requestedUrl;
  const fetchMock = async (url) => {
    requestedUrl = url;
    return jsonResponse({ status: "0", message: "No transactions found", result: [] });
  };

  await findRecentTransactions(`0x${"a".repeat(40)}`, "ethereum", undefined, fetchMock);

  assert.equal(requestedUrl.searchParams.get("offset"), "3");
  assert.equal(requestedUrl.searchParams.get("sort"), "desc");
});

test("preserves transactions older than 90 days in wallet history", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  const oldHash = `0x${"9".repeat(64)}`;
  const olderThanNinetyDays = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
  const fetchMock = async () =>
    jsonResponse({
      status: "1",
      message: "OK",
      result: [
        {
          hash: oldHash,
          from: address,
          timeStamp: String(olderThanNinetyDays),
          isError: "0",
          functionName: ""
        }
      ]
    });

  const result = await findRecentTransactions(address, "base", 8, fetchMock);

  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].hash, oldHash);
  assert.equal(result.transactions[0].timestamp, olderThanNinetyDays);
});

test("treats non-OK HTTP and malformed explorer payloads as failures", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const address = `0x${"a".repeat(40)}`;
  const httpFailure = async () => ({ ok: false, json: async () => ({}) });
  const malformedPayload = async () =>
    jsonResponse({ status: "1", message: "OK", result: { unexpected: true } });

  await assert.rejects(findRecentTransactions(address, "base", 8, httpFailure));
  await assert.rejects(findRecentTransactions(address, "base", 8, malformedPayload));
});

test("treats explorer rate limit payloads as a partial network failure", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const fetchMock = async (url) => {
    if (url.hostname === "base.blockscout.com") {
      return jsonResponse({
        status: "0",
        message: "NOTOK",
        result: "Max rate limit reached"
      });
    }
    return jsonResponse({ status: "0", message: "No transactions found", result: [] });
  };

  const result = await findRecentTransactions(`0x${"a".repeat(40)}`, "auto", 8, fetchMock);

  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.failedNetworkNames, ["Base"]);
});

test("distinguishes total history service failure from an empty wallet", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");
  const fetchMock = async () => {
    throw new Error("offline");
  };

  await assert.rejects(
    findRecentTransactions(`0x${"a".repeat(40)}`, "auto", 8, fetchMock),
    /não foi possível consultar o histórico/i
  );
});

test("reports networks without a configured history indexer", async () => {
  const { findRecentTransactions } = await import("../js/history-client.mjs");

  await assert.rejects(
    findRecentTransactions(`0x${"a".repeat(40)}`, "bnb"),
    /histórico ainda não está disponível/i
  );
});
