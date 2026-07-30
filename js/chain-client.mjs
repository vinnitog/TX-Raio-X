import { NETWORKS } from "./config.mjs";

const RPC_ATTEMPT_TIMEOUT_MS = 9000;

class RpcNotFoundError extends Error {}

class RpcReceiptMissingError extends Error {
  constructor(transaction) {
    super("Recibo ainda não encontrado");
    this.transaction = transaction;
  }
}

class NetworkNotFoundError extends Error {}

async function rpcRequest(network, rpcUrl, method, params, signal) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal
  });

  if (!response.ok) throw new Error(`RPC ${network.name} indisponível`);
  const payload = await response.json();
  const hasResult = Object.prototype.hasOwnProperty.call(payload ?? {}, "result");
  const hasError = Object.prototype.hasOwnProperty.call(payload ?? {}, "error");
  if (payload?.jsonrpc !== "2.0" || payload.id !== 1 || (!hasResult && !hasError)) {
    throw new Error(`Resposta inválida do RPC ${network.name}`);
  }
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

function isTransaction(value, hash) {
  const isAddress = (address) => /^0x[a-fA-F0-9]{40}$/.test(address);
  const isHexData = (data) => /^0x(?:[a-fA-F0-9]{2})*$/.test(data);
  const isHexQuantity = (quantity) => /^0x[a-fA-F0-9]+$/.test(quantity);
  return (
    value &&
    typeof value === "object" &&
    value.hash?.toLowerCase() === hash.toLowerCase() &&
    isAddress(value.from) &&
    (value.to === null || isAddress(value.to)) &&
    isHexData(value.input) &&
    isHexQuantity(value.value) &&
    isHexQuantity(value.gasPrice)
  );
}

function isReceipt(value, hash) {
  const isHexQuantity = (quantity) => /^0x[a-fA-F0-9]+$/.test(quantity);
  return (
    value &&
    typeof value === "object" &&
    value.transactionHash?.toLowerCase() === hash.toLowerCase() &&
    /^0x[01]$/.test(value.status) &&
    Array.isArray(value.logs) &&
    isHexQuantity(value.gasUsed) &&
    (
      value.effectiveGasPrice === undefined ||
      isHexQuantity(value.effectiveGasPrice)
    )
  );
}

async function getBlockContext(network, rpcUrl, receipt, signal) {
  if (!receipt?.blockNumber) return {};

  try {
    const [blockResult, latestBlockResult] = await Promise.allSettled([
      rpcRequest(
        network,
        rpcUrl,
        "eth_getBlockByNumber",
        [receipt.blockNumber, false],
        signal
      ),
      rpcRequest(network, rpcUrl, "eth_blockNumber", [], signal)
    ]);
    const block = blockResult.status === "fulfilled" ? blockResult.value : null;
    const latestBlockNumber = latestBlockResult.status === "fulfilled"
      ? latestBlockResult.value
      : null;
    const validBlock = (
      block &&
      typeof block === "object" &&
      /^0x[a-fA-F0-9]+$/.test(block.number) &&
      /^0x[a-fA-F0-9]+$/.test(block.timestamp) &&
      BigInt(block.number) === BigInt(receipt.blockNumber)
    );
    const validLatestBlock = (
      /^0x[a-fA-F0-9]+$/.test(latestBlockNumber ?? "") &&
      BigInt(latestBlockNumber) >= BigInt(receipt.blockNumber)
    );
    return {
      ...(validBlock ? { block } : {}),
      ...(validLatestBlock ? { latestBlockNumber } : {})
    };
  } catch {
    return {};
  }
}

async function queryRpc(network, rpcUrl, hash, operationSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RPC_ATTEMPT_TIMEOUT_MS);
  const abort = () => controller.abort();
  operationSignal.addEventListener("abort", abort, { once: true });

  try {
    const transaction = await rpcRequest(
      network,
      rpcUrl,
      "eth_getTransactionByHash",
      [hash],
      controller.signal
    );
    if (transaction === null) throw new RpcNotFoundError();
    if (!isTransaction(transaction, hash)) {
      throw new Error(`Transação inválida retornada por ${network.name}`);
    }

    const receipt = await rpcRequest(
      network,
      rpcUrl,
      "eth_getTransactionReceipt",
      [hash],
      controller.signal
    );
    if (receipt === null) throw new RpcReceiptMissingError(transaction);
    if (!isReceipt(receipt, hash)) {
      throw new Error(`Recibo inválido retornado por ${network.name}`);
    }
    const blockContext = await getBlockContext(
      network,
      rpcUrl,
      receipt,
      controller.signal
    );
    return { kind: "found", network, transaction, receipt, ...blockContext };
  } finally {
    clearTimeout(timeout);
    operationSignal.removeEventListener("abort", abort);
  }
}

async function queryNetwork(network, hash, operationSignal) {
  try {
    return await Promise.any(
      network.rpcUrls.map((rpcUrl) =>
        queryRpc(network, rpcUrl, hash, operationSignal)
      )
    );
  } catch (aggregateError) {
    const errors = aggregateError.errors ?? [aggregateError];
    const missingReceipt = errors.find(
      (error) => error instanceof RpcReceiptMissingError
    );
    if (missingReceipt) {
      return {
        kind: "found",
        network,
        transaction: missingReceipt.transaction,
        receipt: null
      };
    }
    if (errors.every((error) => error instanceof RpcNotFoundError)) {
      return { kind: "not-found", network };
    }
    throw errors.find((error) => !(error instanceof RpcNotFoundError)) ?? aggregateError;
  }
}

async function requireFound(network, hash, operationSignal) {
  const result = await queryNetwork(network, hash, operationSignal);
  if (result.kind === "not-found") {
    throw new NetworkNotFoundError();
  }
  return result;
}

export async function findTransaction(hash, selectedNetwork = "auto") {
  const candidates = selectedNetwork === "auto"
    ? NETWORKS
    : NETWORKS.filter((network) => network.id === selectedNetwork);

  if (candidates.length === 0) {
    throw new Error("A rede selecionada não é suportada.");
  }

  const operationController = new AbortController();

  try {
    const found = await Promise.any(
      candidates.map((network) =>
        requireFound(network, hash, operationController.signal)
      )
    );
    operationController.abort();
    const { kind, ...result } = found;
    return result;
  } catch (aggregateError) {
    const errors = aggregateError.errors ?? [aggregateError];
    if (errors.some((error) => !(error instanceof NetworkNotFoundError))) {
      throw new Error(
        "Não foi possível confirmar esse hash agora porque um ou mais provedores RPC falharam. Tente novamente."
      );
    }

    throw new Error(
      selectedNetwork === "auto"
        ? "O hash não foi encontrado nas redes consultadas. Confirme o hash ou escolha a rede."
        : "O hash não foi encontrado na rede escolhida. Confirme o hash e tente novamente."
    );
  } finally {
    operationController.abort();
  }
}
