const METHOD_NAMES = {
  "0xa9059cbb": "Transferência de token",
  "0x095ea7b3": "Autorização de token",
  "0x23b872dd": "Transferência autorizada",
  "0x38ed1739": "Troca de tokens",
  "0x7ff36ab5": "Compra de token",
  "0x18cbafe5": "Venda de token",
  "0x04e45aaf": "Troca concentrada",
  "0x3593564c": "Operação agrupada",
  "0xac9650d8": "Operação agrupada",
  "0x5ae401dc": "Operação agrupada"
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const MAX_UINT_THRESHOLD = 2n ** 255n;

function fromHex(value) {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
}

function formatUnits(value, decimals = 18, maximumFractionDigits = 6) {
  const amount = typeof value === "bigint" ? value : fromHex(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0");
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""}`;
}

function shortAddress(address) {
  if (!address) return "Contrato novo";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function decimalQuantity(value) {
  return value === undefined || value === null ? "—" : fromHex(value).toString();
}

function formatGwei(value) {
  return value === undefined || value === null
    ? "—"
    : `${formatUnits(value, 9, 4)} Gwei`;
}

function formatBlockDate(timestamp) {
  if (timestamp === undefined || timestamp === null) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(Number(fromHex(timestamp)) * 1000));
}

function methodFromInput(input = "0x") {
  if (input === "0x" || input.length < 10) return { selector: "0x", name: "Envio da moeda da rede" };
  const selector = input.slice(0, 10).toLowerCase();
  return { selector, name: METHOD_NAMES[selector] ?? "Interação com contrato" };
}

function inputWord(input, index) {
  const start = 10 + (index * 64);
  const word = input?.slice(start, start + 64);
  return word?.length === 64 ? word : null;
}

function wordAddress(word) {
  return word ? `0x${word.slice(-40)}` : null;
}

function getApprovalAmount(input) {
  if (!input?.toLowerCase().startsWith("0x095ea7b3")) return null;
  const amount = inputWord(input, 1);
  return amount ? BigInt(`0x${amount}`) : null;
}

function hasNftApprovalEvent(receipt) {
  return Boolean(receipt?.logs?.some((log) => (
    log.topics?.[0]?.toLowerCase() === APPROVAL_TOPIC &&
    log.topics.length >= 4
  )));
}

function decodeCall(input = "0x", receipt = null) {
  const selector = input.slice(0, 10).toLowerCase();
  const first = inputWord(input, 0);
  const second = inputWord(input, 1);
  const third = inputWord(input, 2);

  if (selector === "0xa9059cbb" && first && second) {
    return [
      { label: "Destinatário solicitado", value: wordAddress(first), span: 2 },
      {
        label: "Quantidade solicitada",
        value: `${BigInt(`0x${second}`)} unidades mínimas do token`,
        span: 2
      }
    ];
  }

  if (selector === "0x095ea7b3" && first && second) {
    const amount = BigInt(`0x${second}`);
    const isNft = hasNftApprovalEvent(receipt);
    return [
      { label: "Contrato autorizado", value: wordAddress(first), span: 2 },
      {
        label: isNft ? "Token ID solicitado" : "Limite solicitado",
        value: isNft
          ? amount.toString()
          : amount >= MAX_UINT_THRESHOLD
          ? "Praticamente ilimitado"
          : `${amount} unidades mínimas do token`,
        span: 2
      }
    ];
  }

  if (selector === "0x23b872dd" && first && second && third) {
    return [
      { label: "Origem solicitada", value: wordAddress(first), span: 2 },
      { label: "Destino solicitado", value: wordAddress(second), span: 2 },
      {
        label: "Quantidade ou token ID solicitado",
        value: BigInt(`0x${third}`).toString(),
        span: 4
      }
    ];
  }

  return [];
}

function topicAddress(topic) {
  return /^0x[a-fA-F0-9]{64}$/.test(topic ?? "")
    ? `0x${topic.slice(-40)}`
    : "—";
}

function parseMovements(transaction, receipt, network) {
  if (!receipt || fromHex(receipt.status) !== 1n) return [];
  const movements = [];

  if (fromHex(transaction.value) > 0n) {
    movements.push({
      type: `Envio de ${network.nativeSymbol}`,
      summary: `${formatUnits(transaction.value)} ${network.nativeSymbol}`,
      details: `De ${transaction.from} para ${transaction.to ?? "contrato criado"}`
    });
  }

  for (const log of receipt.logs ?? []) {
    const topic = log.topics?.[0]?.toLowerCase();
    if (topic === TRANSFER_TOPIC && log.topics.length >= 3) {
      const isNft = log.topics.length >= 4;
      const amount = isNft
        ? decimalQuantity(log.topics[3])
        : `${decimalQuantity(log.data)} unidades mínimas`;
      movements.push({
        type: isNft ? "Transferência de NFT (ERC-721)" : "Transferência de token",
        summary: isNft ? `Token ID ${amount}` : amount,
        details: `De ${topicAddress(log.topics[1])} para ${topicAddress(log.topics[2])} · contrato ${log.address}`
      });
    }

    if (topic === APPROVAL_TOPIC && log.topics.length >= 3) {
      const isNft = log.topics.length >= 4;
      const amount = isNft ? decimalQuantity(log.topics[3]) : decimalQuantity(log.data);
      movements.push({
        type: isNft
          ? "Permissão de NFT (ERC-721) registrada"
          : "Permissão de token registrada",
        summary: isNft
          ? `Token ID ${amount}`
          : fromHex(log.data) >= MAX_UINT_THRESHOLD
          ? "Limite praticamente ilimitado"
          : `${amount} unidades mínimas`,
        details: `Titular ${topicAddress(log.topics[1])} · autorizado ${topicAddress(log.topics[2])} · contrato ${log.address}`
      });
    }
  }

  return movements;
}

function transactionTypeLabel(type) {
  const labels = {
    "0": "0 · Legacy",
    "1": "1 · EIP-2930",
    "2": "2 · EIP-1559",
    "3": "3 · Blob"
  };
  const value = decimalQuantity(type);
  return labels[value] ?? value;
}

function countEvents(logs = []) {
  return logs.reduce(
    (count, log) => {
      const topic = log.topics?.[0]?.toLowerCase();
      if (topic === TRANSFER_TOPIC) count.transfers += 1;
      if (topic === APPROVAL_TOPIC) count.approvals += 1;
      return count;
    },
    { transfers: 0, approvals: 0 }
  );
}

function getStatus(receipt) {
  if (!receipt) return { label: "Pendente", tone: "warning", success: null };
  const success = fromHex(receipt.status) === 1n;
  return success
    ? { label: "Confirmada", tone: "success", success: true }
    : { label: "Falhou", tone: "danger", success: false };
}

export function isTransactionHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

export function analyzeTransaction({
  network,
  transaction,
  receipt,
  block,
  latestBlockNumber
}) {
  const status = getStatus(receipt);
  const method = methodFromInput(transaction.input);
  const nativeValue = formatUnits(transaction.value);
  const events = countEvents(receipt?.logs);
  const approvalAmount = getApprovalAmount(transaction.input);
  const isNftApproval = status.success === true && hasNftApprovalEvent(receipt);
  const gasUsed = fromHex(receipt?.gasUsed);
  const gasPrice = fromHex(receipt?.effectiveGasPrice ?? transaction.gasPrice);
  const fee = gasUsed && gasPrice ? formatUnits(gasUsed * gasPrice, 18, 7) : "—";
  const blockNumber = receipt?.blockNumber ?? transaction.blockNumber ?? block?.number;
  const confirmations = (
    blockNumber &&
    latestBlockNumber &&
    fromHex(latestBlockNumber) >= fromHex(blockNumber)
  )
    ? (fromHex(latestBlockNumber) - fromHex(blockNumber) + 1n).toString()
    : "—";
  const alerts = [];

  if (status.success === false) {
    alerts.push({
      title: "A operação não foi executada",
      text: "A taxa da rede ainda pode ter sido cobrada, mas a movimentação principal foi revertida."
    });
  }

  if (isNftApproval) {
    alerts.push({
      title: "Autorização de NFT registrada",
      text: "O endereço autorizado recebeu permissão sobre o NFT indicado pelo token ID. Confirme se você reconhece esse endereço."
    });
  } else if (status.success === true && approvalAmount !== null && approvalAmount >= MAX_UINT_THRESHOLD) {
    alerts.push({
      title: "Autorização praticamente ilimitada",
      text: "O contrato recebeu permissão para movimentar uma quantidade muito alta desse token. Revise o endereço autorizado."
    });
  } else if (status.success === true && approvalAmount !== null) {
    alerts.push({
      title: "Esta operação concede uma autorização",
      text: "Nenhum token precisa sair agora, mas o contrato poderá movimentar o limite autorizado posteriormente."
    });
  } else if (status.success === null && approvalAmount !== null) {
    alerts.push({
      title: "Tentativa de autorização pendente",
      text: "A permissão ainda não pode ser considerada ativa porque a transação não foi confirmada."
    });
  }

  if (status.success === true && !transaction.to) {
    alerts.push({
      title: "Criação de contrato",
      text: "Esta transação publicou um novo contrato; ela não é uma transferência comum para outra carteira."
    });
  }

  let title = method.name;
  let summary = `A transação foi encontrada na rede ${network.name}.`;
  let nextStep = "Compare o endereço de destino com o informado pelo serviço ou pessoa que deveria receber.";

  if (status.success === false) {
    title = "A transação falhou";
    summary = `A rede ${network.name} processou a tentativa, mas desfez a operação antes da conclusão.`;
    nextStep = "Não repita imediatamente. Primeiro confira o saldo, a taxa disponível e os dados enviados ao contrato.";
  } else if (status.success === null) {
    title = "A transação ainda está pendente";
    summary = `A rede ${network.name} reconhece o hash, mas ainda não há um recibo de confirmação.`;
    nextStep = "Aguarde alguns minutos e analise novamente antes de tentar substituir ou repetir a operação.";
  } else if (status.success === true && method.selector === "0x095ea7b3") {
    title = "Uma autorização foi concedida";
    summary = "A operação permitiu que um contrato movimentasse tokens em seu nome; isso não significa que os tokens já saíram.";
    nextStep = "Confirme se você reconhece o contrato autorizado e revogue a permissão se ela não for mais necessária.";
  } else if (method.selector === "0x") {
    title = "A moeda da rede foi enviada";
    summary = `${nativeValue} ${network.nativeSymbol} foi direcionado para ${shortAddress(transaction.to)} na rede ${network.name}.`;
  } else if (events.transfers > 0) {
    summary = `A operação foi confirmada e gerou ${events.transfers} evento${events.transfers > 1 ? "s" : ""} de transferência.`;
    nextStep = "Se o saldo não apareceu no destino, confirme se a carteira ou exchange está exibindo a mesma rede.";
  }

  return {
    title,
    status,
    summary,
    details: [
      { label: "Rede", value: network.name },
      { label: "Operação", value: method.name },
      { label: "Bloco", value: decimalQuantity(blockNumber) },
      { label: "Confirmações", value: confirmations },
      { label: "Data e hora do bloco", value: formatBlockDate(block?.timestamp), span: 2 },
      { label: "Valor nativo", value: `${nativeValue} ${network.nativeSymbol}` },
      { label: "Taxa total", value: fee === "—" ? fee : `${fee} ${network.nativeSymbol}` },
      { label: "Gas usado / limite", value: `${decimalQuantity(receipt?.gasUsed)} / ${decimalQuantity(transaction.gas)}`, span: 2 },
      { label: "Transferências", value: String(events.transfers) },
      { label: "Autorizações", value: String(events.approvals) },
      { label: "De", value: transaction.from, span: 2 },
      { label: "Para", value: transaction.to ?? receipt?.contractAddress ?? "Contrato novo", span: 2 }
    ],
    decodedFields: decodeCall(transaction.input, receipt),
    movements: parseMovements(transaction, receipt, network),
    technicalDetails: [
      { label: "Hash completo", value: transaction.hash, span: 4 },
      { label: "Índice no bloco", value: decimalQuantity(receipt?.transactionIndex ?? transaction.transactionIndex) },
      { label: "Nonce", value: decimalQuantity(transaction.nonce) },
      { label: "Tipo da transação", value: transactionTypeLabel(transaction.type) },
      { label: "Seletor", value: method.selector },
      { label: "Tamanho do calldata", value: `${Math.max(0, (transaction.input.length - 2) / 2)} bytes` },
      { label: "Preço efetivo do gas", value: formatGwei(receipt?.effectiveGasPrice ?? transaction.gasPrice) },
      { label: "Max fee por gas", value: formatGwei(transaction.maxFeePerGas) },
      { label: "Prioridade máxima", value: formatGwei(transaction.maxPriorityFeePerGas) },
      { label: "Gas acumulado", value: decimalQuantity(receipt?.cumulativeGasUsed) },
      { label: "Eventos no recibo", value: String(receipt?.logs?.length ?? 0) },
      { label: "Contrato criado", value: receipt?.contractAddress ?? "Não", span: 2 }
    ],
    alerts,
    nextStep,
    explorerUrl: `${network.explorerUrl}${transaction.hash}`
  };
}

export function createDemoAnalysis() {
  return analyzeTransaction({
    network: {
      name: "Base",
      nativeSymbol: "ETH",
      explorerUrl: "https://basescan.org/tx/"
    },
    transaction: {
      hash: `0x${"1".repeat(64)}`,
      from: "0x8a41f42b3d1294740a067495c9444a73dd57f7c1",
      to: "0x4200000000000000000000000000000000000006",
      value: "0x0",
      gas: "0x186a0",
      gasPrice: "0x1dcd6500",
      nonce: "0x16",
      type: "0x2",
      maxFeePerGas: "0x2540be400",
      maxPriorityFeePerGas: "0x3b9aca00",
      input: `0x095ea7b3${"0".repeat(24)}1111111111111111111111111111111111111111${"f".repeat(64)}`
    },
    receipt: {
      status: "0x1",
      blockNumber: "0x1312d00",
      transactionIndex: "0x2a",
      gasUsed: "0xb5f8",
      cumulativeGasUsed: "0x2dc6c0",
      effectiveGasPrice: "0x1dcd6500",
      contractAddress: null,
      logs: [{
        address: "0x4200000000000000000000000000000000000006",
        topics: [
          APPROVAL_TOPIC,
          `0x${"0".repeat(24)}8a41f42b3d1294740a067495c9444a73dd57f7c1`,
          `0x${"0".repeat(24)}1111111111111111111111111111111111111111`
        ],
        data: `0x${"f".repeat(64)}`
      }]
    },
    block: { number: "0x1312d00", timestamp: "0x66fc32d0" },
    latestBlockNumber: "0x1312d0c"
  });
}
