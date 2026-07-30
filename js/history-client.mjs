import { FREE_WALLET_HISTORY_LIMIT, NETWORKS } from "./config.mjs";

const REQUEST_TIMEOUT_MS = 8000;

export function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function sortTransactions(transactions, order = "desc") {
  const direction = order === "asc" ? 1 : -1;
  return [...transactions].sort(
    (left, right) => (left.timestamp - right.timestamp) * direction
  );
}

function normalizeTransaction(transaction, network, address) {
  const from = transaction.from?.toLowerCase() ?? "";
  const wallet = address.toLowerCase();

  return {
    hash: transaction.hash,
    networkId: network.id,
    networkName: network.name,
    timestamp: Number(transaction.timeStamp) || 0,
    direction: from === wallet ? "Enviada" : "Recebida",
    status: transaction.isError === "1" ? "Falhou" : "Confirmada",
    method: transaction.functionName?.split("(")[0] || transaction.methodId || "Transação"
  };
}

async function fetchNetworkHistory(network, address, limit, fetchImpl) {
  const url = new URL(network.historyApiUrl);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${network.name} indisponível`);

    const payload = await response.json();
    if (payload.status === "0" && /no transactions/i.test(payload.message ?? "")) return [];
    if (!Array.isArray(payload.result)) throw new Error(`Resposta inválida de ${network.name}`);

    return payload.result
      .filter((transaction) => /^0x[a-fA-F0-9]{64}$/.test(transaction.hash ?? ""))
      .map((transaction) => normalizeTransaction(transaction, network, address));
  } finally {
    clearTimeout(timeout);
  }
}

export async function findRecentTransactions(
  address,
  selectedNetwork = "auto",
  limit = FREE_WALLET_HISTORY_LIMIT,
  fetchImpl = fetch
) {
  const candidates = NETWORKS.filter(
    (network) =>
      network.historyApiUrl &&
      (selectedNetwork === "auto" || network.id === selectedNetwork)
  );

  if (candidates.length === 0) {
    throw new Error("O histórico ainda não está disponível para essa rede.");
  }

  const attempts = await Promise.allSettled(
    candidates.map((network) => fetchNetworkHistory(network, address, limit, fetchImpl))
  );
  const successful = attempts.filter((attempt) => attempt.status === "fulfilled");

  if (successful.length === 0) {
    throw new Error("Não foi possível consultar o histórico agora. Tente novamente em alguns instantes.");
  }

  const transactions = successful
    .flatMap((attempt) => attempt.value)
    .sort((left, right) => right.timestamp - left.timestamp)
    .filter(
      (transaction, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.networkId === transaction.networkId &&
            candidate.hash === transaction.hash
        ) === index
    )
    .slice(0, limit);

  const failedNetworkNames = attempts
    .map((attempt, index) => ({ attempt, networkName: candidates[index].name }))
    .filter(({ attempt }) => attempt.status === "rejected")
    .map(({ networkName }) => networkName);

  return {
    transactions,
    failedNetworks: attempts.length - successful.length,
    failedNetworkNames,
    searchedNetworks: candidates.length
  };
}
