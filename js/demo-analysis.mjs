const DEMO_ANALYSIS = Object.freeze({
  title: "Uma autorização foi concedida",
  status: { label: "Confirmada", tone: "success", success: true },
  summary: "A operação permitiu que um contrato movimentasse tokens em seu nome; isso não significa que os tokens já saíram.",
  details: [
    { label: "Rede", value: "Base" },
    { label: "Operação", value: "Autorização de token" },
    { label: "Bloco", value: "20000000" },
    { label: "Confirmações", value: "13" },
    { label: "Data e hora do bloco", value: "1 de out. de 2024, 14:35:12", span: 2 },
    { label: "Valor nativo", value: "0 ETH" },
    { label: "Taxa total", value: "0.0000232 ETH" },
    { label: "Gas usado / limite", value: "46584 / 100000", span: 2 },
    { label: "Transferências", value: "0" },
    { label: "Autorizações", value: "1" },
    { label: "De", value: "0x8a41f42b3d1294740a067495c9444a73dd57f7c1", span: 2 },
    { label: "Para", value: "0x4200000000000000000000000000000000000006", span: 2 }
  ],
  decodedFields: [
    { label: "Contrato autorizado", value: "0x1111111111111111111111111111111111111111", span: 2 },
    { label: "Limite solicitado", value: "Praticamente ilimitado", span: 2 }
  ],
  movements: [{
    type: "Permissão de token registrada",
    summary: "Limite praticamente ilimitado",
    details: "Titular 0x8a41f42b3d1294740a067495c9444a73dd57f7c1 · autorizado 0x1111111111111111111111111111111111111111 · contrato 0x4200000000000000000000000000000000000006"
  }],
  technicalDetails: [
    { label: "Hash completo", value: `0x${"1".repeat(64)}`, span: 4 },
    { label: "Índice no bloco", value: "42" },
    { label: "Nonce", value: "22" },
    { label: "Tipo da transação", value: "2 · EIP-1559" },
    { label: "Seletor", value: "0x095ea7b3" },
    { label: "Tamanho do calldata", value: "68 bytes" },
    { label: "Preço efetivo do gas", value: "0.5 Gwei" },
    { label: "Max fee por gas", value: "10 Gwei" },
    { label: "Prioridade máxima", value: "1 Gwei" },
    { label: "Gas acumulado", value: "3000000" },
    { label: "Eventos no recibo", value: "1" },
    { label: "Contrato criado", value: "Não", span: 2 }
  ],
  alerts: [{
    title: "Autorização praticamente ilimitada",
    text: "O contrato recebeu permissão para movimentar uma quantidade muito alta desse token. Revise o endereço autorizado."
  }],
  nextStep: "Confirme se você reconhece o contrato autorizado e revogue a permissão se ela não for mais necessária.",
  explorerUrl: `https://basescan.org/tx/0x${"1".repeat(64)}`
});

export function isTransactionHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value ?? "").trim());
}

export function createDemoAnalysis() {
  return structuredClone(DEMO_ANALYSIS);
}
