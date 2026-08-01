import {
  CREDIT_PACK_PRICE,
  CREDIT_PACK_SIZE,
  FREE_ANALYSES,
  FREE_WALLET_HISTORY_LIMIT,
  isLocalTestEnvironment,
  UNLOCKED_WALLET_HISTORY_LIMIT
} from "./config.mjs";
import { analyzeTransaction, createDemoAnalysis, isTransactionHash } from "./analyzer.mjs";
import { findTransaction } from "./chain-client.mjs";
import {
  findRecentTransactions,
  isWalletAddress,
  sortTransactions
} from "./history-client.mjs";
import {
  addCredits,
  consumeAnalysis,
  getFreeRemaining,
  getHistoryLimit,
  readUsage
} from "./usage.mjs";
import { CheckoutClientError, createCheckoutClient } from "./checkout-client.mjs";
import {
  CreditClientError,
  createCreditClient,
  fingerprintAnalysis
} from "./credit-client.mjs";
import {
  createCheckoutLoadingController,
  createRetryableLoader,
  navigateToCheckout,
  openCheckoutTab,
  replaceCheckoutReturn,
  runCheckoutAttempt,
  sanitizeCheckoutReturn
} from "./checkout-flow.mjs";
import { initAuthController } from "./auth-controller.mjs";

const COPYABLE_DETAIL_LABELS = Object.freeze(["De", "Para", "Hash completo"]);
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const FIELD_HELP = Object.freeze({
  "Rede": "Blockchain em que a transação foi registrada. Uma mesma carteira pode operar em várias redes independentes.",
  "Operação": "Leitura do que a transação tentou fazer, identificada pelo valor enviado, pela função chamada e pelos eventos emitidos.",
  "Bloco": "Número do bloco que incluiu a transação. Blocos agrupam transações confirmadas pela rede.",
  "Confirmações": "Quantidade de blocos produzidos desde a inclusão da transação. Quanto maior o número, mais consolidado está o registro.",
  "Data e hora do bloco": "Momento registrado pelo bloco que incluiu a transação. Pode haver uma pequena diferença em relação ao horário em que ela foi enviada.",
  "Valor nativo": "Quantidade da moeda principal da rede enviada diretamente na transação, como ETH, BNB ou POL. Não inclui tokens movimentados por contratos.",
  "Taxa total": "Custo efetivamente pago à rede. É calculado multiplicando o gas utilizado pelo preço efetivo do gas.",
  "Gas usado / limite": "Gas usado é o trabalho computacional consumido. O limite é o máximo que o remetente permitiu gastar; a parte não utilizada não é cobrada.",
  "Transferências": "Número de eventos padrão de transferência encontrados no recibo. Uma única transação pode gerar várias movimentações de tokens.",
  "Autorizações": "Número de permissões de token registradas nos eventos. Uma autorização pode permitir que outro endereço movimente tokens no futuro.",
  "De": "Endereço público que assinou e enviou a transação.",
  "Para": "Endereço público que recebeu a chamada. Pode ser uma carteira ou um contrato inteligente.",
  "Destinatário solicitado": "Endereço informado dentro da chamada do contrato como destino da transferência.",
  "Quantidade solicitada": "Quantidade codificada na chamada. Sem consultar os metadados do token, ela é exibida em unidades mínimas.",
  "Contrato autorizado": "Endereço que recebeu permissão para movimentar o token em nome do titular.",
  "Token ID solicitado": "Identificador único do NFT mencionado na autorização.",
  "Limite solicitado": "Quantidade máxima que o endereço autorizado poderá movimentar. Valores extremamente altos costumam representar permissão ilimitada.",
  "Origem solicitada": "Endereço do qual o contrato foi instruído a retirar o token.",
  "Destino solicitado": "Endereço para o qual o contrato foi instruído a enviar o token.",
  "Quantidade ou token ID solicitado": "Terceiro parâmetro da chamada: pode representar uma quantidade de token fungível ou o identificador de um NFT.",
  "Hash completo": "Identificador único da transação. Ele permite localizar exatamente este registro em exploradores e serviços da rede.",
  "Índice no bloco": "Posição ocupada pela transação dentro do bloco em que foi incluída.",
  "Nonce": "Contador de transações enviadas por um endereço. Ele define a ordem dos envios e impede que a mesma transação seja executada novamente.",
  "Tipo da transação": "Formato técnico usado pela rede. EIP-1559, por exemplo, permite definir teto de taxa e prioridade separadamente.",
  "Seletor": "Os quatro primeiros bytes do calldata. Eles normalmente identificam qual função do contrato foi chamada.",
  "Tamanho do calldata": "Quantidade de bytes enviados como instruções e parâmetros para o contrato.",
  "Preço efetivo do gas": "Preço realmente pago por cada unidade de gas, exibido em Gwei.",
  "Max fee por gas": "Teto que o remetente aceitou pagar por unidade de gas. Não significa que todo esse valor foi cobrado.",
  "Prioridade máxima": "Gorjeta máxima por unidade de gas oferecida ao validador para priorizar a transação.",
  "Gas acumulado": "Total de gas consumido no bloco até o processamento desta transação, incluindo as anteriores.",
  "Eventos no recibo": "Quantidade total de registros emitidos pelos contratos durante a execução. Eles ajudam a identificar transferências e outras ações.",
  "Contrato criado": "Endereço do novo contrato quando a transação fez uma implantação. “Não” indica que nenhum contrato foi criado."
});

const elements = {
  form: document.querySelector("#analyzer-form"),
  hash: document.querySelector("#transaction-hash"),
  network: document.querySelector("#network"),
  error: document.querySelector("#hash-error"),
  analyzeButton: document.querySelector("#analyze-button"),
  demoButton: document.querySelector("#demo-button"),
  walletToggle: document.querySelector("#wallet-toggle"),
  walletPanel: document.querySelector("#wallet-panel"),
  walletForm: document.querySelector("#wallet-form"),
  walletAddress: document.querySelector("#wallet-address"),
  walletNetwork: document.querySelector("#wallet-network"),
  walletSort: document.querySelector("#wallet-sort"),
  walletLimitLabel: document.querySelector("#wallet-limit-label"),
  walletError: document.querySelector("#wallet-error"),
  walletSearchButton: document.querySelector("#wallet-search-button"),
  walletResults: document.querySelector("#wallet-results"),
  walletResultsTitle: document.querySelector("#wallet-results-title"),
  walletResultsNote: document.querySelector("#wallet-results-note"),
  transactionList: document.querySelector("#transaction-list"),
  usageText: document.querySelector("#usage-text"),
  creditPackSizeLabels: document.querySelectorAll("[data-credit-pack-size]"),
  creditPackPriceLabels: document.querySelectorAll("[data-credit-pack-price]"),
  creditUnitPriceLabels: document.querySelectorAll("[data-credit-unit-price]"),
  walletPremiumLimitLabels: document.querySelectorAll("[data-wallet-premium-limit]"),
  priceSection: document.querySelector(".price-section"),
  resultSection: document.querySelector("#result-section"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  statusBadge: document.querySelector("#status-badge"),
  resultSummary: document.querySelector("#result-summary"),
  detailGrid: document.querySelector("#detail-grid"),
  decodedSection: document.querySelector("#decoded-section"),
  decodedGrid: document.querySelector("#decoded-grid"),
  movementSection: document.querySelector("#movement-section"),
  movementList: document.querySelector("#movement-list"),
  technicalGrid: document.querySelector("#technical-grid"),
  alertList: document.querySelector("#alert-list"),
  nextStepText: document.querySelector("#next-step-text"),
  explorerLink: document.querySelector("#explorer-link"),
  paywall: document.querySelector("#paywall-dialog"),
  closeDialog: document.querySelector("#dialog-close"),
  laterButton: document.querySelector("#dialog-later"),
  dialogUnlock: document.querySelector("#dialog-unlock-button"),
  priceUnlock: document.querySelector("#price-unlock-button"),
  accountButton: document.querySelector("#account-button"),
  accountBalance: document.querySelector("#auth-account-balance"),
  fieldHelpDialog: document.querySelector("#field-help-dialog"),
  fieldHelpClose: document.querySelector("#field-help-close"),
  fieldHelpConfirm: document.querySelector("#field-help-confirm"),
  fieldHelpTitle: document.querySelector("#field-help-title"),
  fieldHelpText: document.querySelector("#field-help-text"),
  toast: document.querySelector("#toast")
};

let toastTimer;
let analysisInProgress = false;
let walletSearchInProgress = false;
let authControllerPromise = null;
let currentWalletHistory = null;
let entitlementRequestId = 0;
let accountEntitlement = {
  status: "guest",
  userId: null,
  balance: 0,
  hasPaidAccess: false
};
const IS_LOCAL_DEMO = isLocalTestEnvironment(window.location.hostname);
const checkoutLoading = createCheckoutLoadingController([
  elements.priceUnlock,
  elements.dialogUnlock
]);
const getCheckoutClient = createRetryableLoader(
  () => import("./supabase-client.mjs"),
  ({ supabase }) => createCheckoutClient(supabase)
);
const getCreditClient = createRetryableLoader(
  () => import("./supabase-client.mjs"),
  ({ supabase }) => createCreditClient(supabase)
);

function hasPaidWalletAccess(usage = readUsage(localStorage)) {
  if (usage.unlocked) return true;
  return IS_LOCAL_DEMO ? usage.paid : accountEntitlement.hasPaidAccess;
}

function updateUsageLabel() {
  const usage = readUsage(localStorage);
  const freeRemaining = getFreeRemaining(usage, FREE_ANALYSES);
  if (usage.unlocked) {
    elements.usageText.textContent = "Acesso legado ilimitado";
  } else if (freeRemaining > 0) {
    elements.usageText.textContent = `${freeRemaining} ${freeRemaining === 1 ? "análise grátis" : "análises grátis"}`;
  } else if (IS_LOCAL_DEMO && usage.credits > 0) {
    elements.usageText.textContent = `${usage.credits} ${usage.credits === 1 ? "análise disponível" : "análises disponíveis"}`;
  } else if (accountEntitlement.status === "loading") {
    elements.usageText.textContent = "Carregando saldo…";
  } else if (accountEntitlement.status === "ready" && accountEntitlement.balance > 0) {
    const balance = accountEntitlement.balance;
    elements.usageText.textContent = `${balance} ${balance === 1 ? "análise disponível" : "análises disponíveis"}`;
  } else if (accountEntitlement.status === "error") {
    elements.usageText.textContent = "Saldo indisponível";
  } else {
    elements.usageText.textContent = "Análises extras esgotadas";
  }
}

function getWalletHistoryLimit() {
  const usage = readUsage(localStorage);
  return getHistoryLimit(
    { ...usage, paid: hasPaidWalletAccess(usage) },
    FREE_WALLET_HISTORY_LIMIT,
    UNLOCKED_WALLET_HISTORY_LIMIT
  );
}

function updateWalletLimitLabel() {
  const hasPaidAccess = hasPaidWalletAccess();
  elements.walletLimitLabel.textContent = hasPaidAccess
    ? `Até ${UNLOCKED_WALLET_HISTORY_LIMIT} transações no acesso pago`
    : `Últimas ${FREE_WALLET_HISTORY_LIMIT} no acesso grátis`;
}

function updateConfiguredCopy() {
  for (const label of elements.walletPremiumLimitLabels) {
    label.textContent = String(UNLOCKED_WALLET_HISTORY_LIMIT);
  }
  for (const label of elements.creditPackSizeLabels) {
    label.textContent = String(CREDIT_PACK_SIZE);
  }
  for (const label of elements.creditPackPriceLabels) {
    label.textContent = CREDIT_PACK_PRICE.toFixed(2).replace(".", ",");
  }
  for (const label of elements.creditUnitPriceLabels) {
    label.textContent = (CREDIT_PACK_PRICE / CREDIT_PACK_SIZE)
      .toFixed(2)
      .replace(".", ",");
  }
}

function updatePurchaseAvailability() {
  elements.priceSection.hidden = readUsage(localStorage).unlocked;
}

function showToast(message, duration = 4200) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
}

function fallbackCopyText(text) {
  const previouslyFocused = document.activeElement;
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();

  try {
    return document.execCommand("copy");
  } finally {
    input.remove();
    previouslyFocused?.focus?.({ preventScroll: true });
  }
}

function isCopyableDetail(label, value) {
  if (!COPYABLE_DETAIL_LABELS.includes(label)) return false;
  const text = String(value);
  return label === "Hash completo"
    ? TRANSACTION_HASH_PATTERN.test(text)
    : EVM_ADDRESS_PATTERN.test(text);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Alguns navegadores expõem a API, mas bloqueiam seu uso fora de um gesto autorizado.
    }
  }

  try {
    return fallbackCopyText(text);
  } catch {
    return false;
  }
}

function setLoading(isLoading) {
  elements.analyzeButton.disabled = isLoading;
  elements.analyzeButton.classList.toggle("is-loading", isLoading);
  elements.analyzeButton.querySelector(".button-label").textContent = isLoading
    ? "Lendo a blockchain…"
    : "Analisar transação";
}

function setTransactionLoading(button, isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? "Lendo a blockchain…" : getAnalyzeActionLabel();
  button.setAttribute("aria-busy", String(isLoading));
}

function setAnalysisControlsDisabled(isDisabled) {
  elements.analyzeButton.disabled = isDisabled;
  elements.demoButton.disabled = isDisabled;
  elements.walletToggle.disabled = isDisabled;
  elements.walletSearchButton.disabled = isDisabled;
  elements.walletSort.disabled = isDisabled;
  for (const button of elements.transactionList.querySelectorAll(".transaction-action")) {
    button.disabled = isDisabled;
  }
}

function updateTransactionActionLabels() {
  for (const button of elements.transactionList.querySelectorAll(".transaction-action")) {
    if (button.getAttribute("aria-busy") !== "true") {
      button.textContent = getAnalyzeActionLabel();
    }
  }
}

function setWalletLoading(isLoading) {
  elements.walletSearchButton.disabled = isLoading;
  elements.walletSearchButton.classList.toggle("is-loading", isLoading);
  elements.walletSearchButton.querySelector(".button-label").textContent = isLoading
    ? "Buscando histórico…"
    : "Buscar últimos hashes";
}

function formatTransactionDate(timestamp) {
  if (!timestamp) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp * 1000));
}

function getAnalyzeActionLabel() {
  const usage = readUsage(localStorage);
  if (usage.unlocked) return "Analisar";
  if (getFreeRemaining(usage, FREE_ANALYSES) > 0) return "Analisar · usa 1 grátis";
  if (IS_LOCAL_DEMO && usage.credits > 0) return "Analisar · usa 1 análise extra";
  if (accountEntitlement.status === "loading") return "Analisar · carregando saldo";
  if (accountEntitlement.status === "ready" && accountEntitlement.balance > 0) {
    return "Analisar · usa 1 crédito da conta";
  }
  return "Analisar · requer análises extras";
}

function renderAccountEntitlement() {
  if (elements.accountBalance) {
    elements.accountBalance.classList.toggle("is-error", accountEntitlement.status === "error");
    if (accountEntitlement.status === "loading") {
      elements.accountBalance.textContent = "Carregando saldo da conta…";
    } else if (accountEntitlement.status === "ready") {
      const balance = accountEntitlement.balance;
      elements.accountBalance.textContent = `Saldo: ${balance} ${balance === 1 ? "análise" : "análises"}`;
    } else if (accountEntitlement.status === "error") {
      elements.accountBalance.textContent = "Saldo indisponível. Verifique sua conexão.";
    } else {
      elements.accountBalance.textContent = "";
    }
  }
  updateUsageLabel();
  updateWalletLimitLabel();
  updateTransactionActionLabels();
}

async function refreshCreditEntitlement(session) {
  const requestId = ++entitlementRequestId;
  if (session === null || (session && !session.user?.id)) {
    accountEntitlement = { status: "guest", userId: null, balance: 0, hasPaidAccess: false };
    renderAccountEntitlement();
    return accountEntitlement;
  }

  const expectedUserId = session?.user?.id ?? accountEntitlement.userId;
  accountEntitlement = {
    ...accountEntitlement,
    status: "loading",
    userId: expectedUserId ?? null
  };
  renderAccountEntitlement();
  try {
    const entitlement = await (await getCreditClient()).getEntitlement();
    if (requestId !== entitlementRequestId) return accountEntitlement;
    accountEntitlement = { status: "ready", ...entitlement };
  } catch (error) {
    if (requestId !== entitlementRequestId) return accountEntitlement;
    accountEntitlement = error instanceof CreditClientError
      && error.code === "authentication_required"
      ? { status: "guest", userId: null, balance: 0, hasPaidAccess: false }
      : { status: "error", userId: expectedUserId ?? null, balance: 0, hasPaidAccess: false };
  }
  renderAccountEntitlement();
  return accountEntitlement;
}

function renderWalletHistory({
  transactions,
  failedNetworks,
  failedNetworkNames,
  searchedNetworks
}, moveFocus = true) {
  const orderedTransactions = sortTransactions(transactions, elements.walletSort.value);
  elements.walletResults.hidden = false;
  elements.walletResultsTitle.textContent = transactions.length
    ? `${transactions.length} ${transactions.length === 1 ? "transação encontrada" : "transações encontradas"}`
    : "Nenhuma transação encontrada";
  elements.walletResultsNote.textContent = failedNetworks
    ? `Resultado parcial · falhou: ${failedNetworkNames.join(", ")}`
    : `${searchedNetworks} ${searchedNetworks === 1 ? "rede consultada" : "redes consultadas"}`;

  if (transactions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "wallet-empty";
    empty.textContent = "Não encontramos transações normais indexadas. Isso não exclui transferências de tokens ou eventos internos.";
    elements.transactionList.replaceChildren(empty);
    if (moveFocus) {
      elements.walletResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
      elements.walletResultsTitle.focus({ preventScroll: true });
    }
    return;
  }

  elements.transactionList.replaceChildren(
    ...orderedTransactions.map((transaction) => {
      const item = document.createElement("article");
      item.className = "transaction-item";

      const main = document.createElement("div");
      main.className = "transaction-main";

      const meta = document.createElement("div");
      meta.className = "transaction-meta";
      for (const value of [
        transaction.networkName,
        transaction.direction,
        transaction.status,
        formatTransactionDate(transaction.timestamp)
      ]) {
        const label = document.createElement("span");
        label.textContent = value;
        meta.append(label);
      }

      const hash = document.createElement("strong");
      hash.className = "transaction-hash";
      hash.textContent = transaction.hash;
      hash.title = transaction.hash;
      main.append(meta, hash);

      const analyzeButton = document.createElement("button");
      analyzeButton.className = "transaction-action";
      analyzeButton.type = "button";
      analyzeButton.textContent = getAnalyzeActionLabel();
      const shortHash = `${transaction.hash.slice(0, 8)}…${transaction.hash.slice(-6)}`;
      analyzeButton.setAttribute(
        "aria-label",
        `Analisar transação ${shortHash} da rede ${transaction.networkName}`
      );
      analyzeButton.addEventListener("click", async () => {
        await runAnalysis(
          transaction.hash,
          transaction.networkId,
          (isLoading) => setTransactionLoading(analyzeButton, isLoading),
          showToast
        );
      });

      item.append(main, analyzeButton);
      return item;
    })
  );

  if (moveFocus) {
    elements.walletResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
    elements.walletResultsTitle.focus({ preventScroll: true });
  }
}

function showResult(result, isDemo = false) {
  elements.resultKicker.textContent = isDemo ? "Exemplo de resultado" : "Resultado da análise";
  elements.resultTitle.textContent = result.title;
  elements.statusBadge.textContent = result.status.label;
  elements.statusBadge.dataset.tone = result.status.tone;
  elements.resultSummary.textContent = result.summary;
  elements.nextStepText.textContent = result.nextStep;
  elements.explorerLink.href = result.explorerUrl;

  const createDetailItem = ({ label, value, span = 1 }) => {
    const item = document.createElement("div");
    item.className = "detail-item";
    item.dataset.span = String(span);

    const heading = document.createElement("div");
    heading.className = "detail-item-heading";
    const itemLabel = document.createElement("span");
    const helpButton = document.createElement("button");
    const itemValue = document.createElement("strong");
    itemLabel.textContent = label;
    helpButton.className = "field-help-button";
    helpButton.type = "button";
    helpButton.setAttribute("aria-label", `Entender o campo ${label}`);
    helpButton.textContent = "?";
    helpButton.addEventListener("click", () => openFieldHelp(label));
    itemValue.textContent = value;
    heading.append(itemLabel, helpButton);
    item.append(heading);

    if (isCopyableDetail(label, value)) {
      const valueRow = document.createElement("div");
      const copyButton = document.createElement("button");
      const copyLabel = `Copiar ${label.toLocaleLowerCase("pt-BR")}`;
      let copyFeedbackTimer;
      let copyInProgress = false;
      valueRow.className = "detail-item-value-row";
      copyButton.className = "copy-button";
      copyButton.type = "button";
      copyButton.setAttribute("aria-label", copyLabel);
      copyButton.innerHTML = `
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
          <rect x="9" y="9" width="11" height="11" rx="2"></rect>
          <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>
        </svg>
      `;
      copyButton.addEventListener("click", async () => {
        if (copyInProgress) return;
        copyInProgress = true;
        copyButton.disabled = true;
        clearTimeout(copyFeedbackTimer);
        copyButton.classList.remove("is-copied");
        copyButton.setAttribute("aria-label", `Copiando ${label.toLocaleLowerCase("pt-BR")}`);

        let copied = false;
        try {
          copied = await copyText(String(value));
        } finally {
          copyInProgress = false;
          copyButton.disabled = false;
        }

        if (!copied) {
          copyButton.setAttribute("aria-label", copyLabel);
          showToast(`Não foi possível copiar ${label.toLocaleLowerCase("pt-BR")}.`);
          return;
        }

        copyButton.classList.add("is-copied");
        copyButton.setAttribute("aria-label", `${label} copiado`);
        showToast(`${label} copiado.`);
        copyFeedbackTimer = setTimeout(() => {
          copyButton.classList.remove("is-copied");
          copyButton.setAttribute("aria-label", copyLabel);
        }, 1800);
      });
      valueRow.append(itemValue, copyButton);
      item.append(valueRow);
    } else {
      item.append(itemValue);
    }
    return item;
  };

  elements.detailGrid.replaceChildren(...result.details.map(createDetailItem));

  elements.decodedSection.hidden = result.decodedFields.length === 0;
  elements.decodedGrid.replaceChildren(...result.decodedFields.map(createDetailItem));

  elements.movementSection.hidden = result.movements.length === 0;
  elements.movementList.replaceChildren(
    ...result.movements.map(({ type, summary, details }) => {
      const item = document.createElement("article");
      item.className = "movement-item";
      const itemType = document.createElement("span");
      const itemSummary = document.createElement("strong");
      const itemDetails = document.createElement("p");
      itemType.textContent = type;
      itemSummary.textContent = summary;
      itemDetails.textContent = details;
      item.append(itemType, itemSummary, itemDetails);
      return item;
    })
  );

  elements.technicalGrid.replaceChildren(
    ...result.technicalDetails.map(createDetailItem)
  );

  elements.alertList.replaceChildren(
    ...result.alerts.map(({ title, text }) => {
      const item = document.createElement("div");
      item.className = "alert-item";
      const itemTitle = document.createElement("strong");
      const itemText = document.createElement("p");
      itemTitle.textContent = title;
      itemText.textContent = text;
      item.append(itemTitle, itemText);
      return item;
    })
  );

  elements.resultSection.hidden = false;
  elements.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.resultTitle.focus({ preventScroll: true });
}

function openFieldHelp(label) {
  elements.fieldHelpTitle.textContent = label;
  elements.fieldHelpText.textContent = FIELD_HELP[label]
    ?? "Este dado foi extraído diretamente da transação ou do recibo público registrado na blockchain.";

  if (typeof elements.fieldHelpDialog.showModal === "function") {
    elements.fieldHelpDialog.showModal();
  }
}

function openPaywall() {
  if (typeof elements.paywall.showModal === "function") {
    elements.paywall.showModal();
  } else {
    showToast(`O pacote custa R$ ${CREDIT_PACK_PRICE.toFixed(2).replace(".", ",")}.`);
  }
}

async function runAnalysis(hash, networkId, setPending, showError) {
  if (analysisInProgress || walletSearchInProgress) return;

  const usage = readUsage(localStorage);
  const freeRemaining = getFreeRemaining(usage, FREE_ANALYSES);
  const usesLocalCredit = IS_LOCAL_DEMO && !usage.unlocked
    && freeRemaining === 0 && usage.credits > 0;
  const requiresAccountCredit = !usage.unlocked && freeRemaining === 0 && !usesLocalCredit;

  if (requiresAccountCredit && accountEntitlement.status !== "ready") {
    await refreshCreditEntitlement();
  }
  if (requiresAccountCredit && accountEntitlement.status === "error") {
    showError("Não conseguimos consultar o saldo da sua conta. Verifique a conexão e tente novamente.");
    return;
  }
  if (requiresAccountCredit && accountEntitlement.balance < 1) {
    openPaywall();
    return;
  }
  const expectedCreditUserId = requiresAccountCredit ? accountEntitlement.userId : null;
  if (requiresAccountCredit && !expectedCreditUserId) {
    showError("Não conseguimos confirmar a conta responsável pelo crédito. Entre novamente.");
    return;
  }

  analysisInProgress = true;
  setPending(true);
  setAnalysisControlsDisabled(true);
  try {
    const rawTransaction = await findTransaction(hash, networkId);
    const result = analyzeTransaction(rawTransaction);
    if (requiresAccountCredit) {
      try {
        const fingerprint = await fingerprintAnalysis(hash, networkId);
        const creditClient = await getCreditClient();
        const analysisId = creditClient.prepareAnalysis(expectedCreditUserId, fingerprint);
        const consumption = await creditClient.consume(analysisId, expectedCreditUserId);
        accountEntitlement = {
          ...accountEntitlement,
          status: "ready",
          balance: consumption.balance
        };
        renderAccountEntitlement();
      } catch (error) {
        if (error instanceof CreditClientError && error.code === "credits_exhausted") {
          accountEntitlement = { ...accountEntitlement, status: "ready", balance: 0 };
          renderAccountEntitlement();
          openPaywall();
          showError("Seu saldo foi usado em outra sessão. Recarregue a conta para continuar.");
        } else if (error instanceof CreditClientError && error.code === "account_changed") {
          showError("A conta mudou durante a análise. Entre novamente na conta original para confirmar o crédito.");
        } else if (error instanceof CreditClientError
          && error.code === "consumption_reconciliation_required") {
          showError("Existe uma análise anterior aguardando confirmação. Repita aquela análise antes de iniciar outra.");
        } else {
          showError("A análise foi encontrada, mas não conseguimos confirmar o uso do crédito. Tente novamente.");
        }
        return;
      }
    }
    showResult(result);
    if (!requiresAccountCredit) {
      try {
        consumeAnalysis(localStorage, FREE_ANALYSES);
        updateUsageLabel();
      } catch {
        showToast("A análise foi concluída, mas este navegador bloqueou o salvamento do limite.");
      }
    }
  } catch (error) {
    showError(error.message);
  } finally {
    analysisInProgress = false;
    setPending(false);
    setAnalysisControlsDisabled(false);
    updateTransactionActionLabels();
  }
}

function activateCreditPack(message) {
  try {
    addCredits(localStorage, CREDIT_PACK_SIZE);
  } catch {
    showToast("Não foi possível salvar as análises neste navegador.");
    return false;
  }

  if (elements.paywall.open) elements.paywall.close();
  updateUsageLabel();
  updateWalletLimitLabel();
  currentWalletHistory = null;
  elements.walletResults.hidden = true;
  elements.transactionList.replaceChildren();
  showToast(message);
  return true;
}

function getCheckoutErrorMessage(error) {
  if (!(error instanceof CheckoutClientError)) {
    return "Não conseguimos abrir o checkout agora. Verifique sua conexão e tente novamente.";
  }
  if (["checkout_in_progress", "checkout_reconciliation_required"].includes(error.code)) {
    return "Seu checkout ainda está sendo preparado. Aguarde alguns segundos e tente novamente.";
  }
  if (error.code === "origin_not_allowed") {
    return "Este endereço ainda não está autorizado para iniciar compras.";
  }
  return "Não conseguimos abrir o checkout de teste agora. Tente novamente.";
}

async function beginCheckout() {
  if (readUsage(localStorage).unlocked) {
    showToast("Seu acesso legado já é ilimitado.");
    return;
  }

  if (IS_LOCAL_DEMO) {
    activateCreditPack(`${CREDIT_PACK_SIZE} análises adicionadas · simulação local, sem pagamento.`);
    return;
  }

  try {
    const outcome = await runCheckoutAttempt({
      loading: checkoutLoading,
      openTab: () => openCheckoutTab(window),
      startCheckout: async () => (await getCheckoutClient()).start(),
      openAuth: async () => (await authControllerPromise)?.open() ?? false,
      navigate: (tab, url) => navigateToCheckout(tab, url, window.location)
    });
    if (outcome.status === "auth_unavailable") {
      showToast("A conta está indisponível agora. Verifique sua conexão e tente novamente.");
      return;
    }
    if (outcome.status === "auth_required") {
      if (elements.paywall.open) elements.paywall.close();
      showToast("Entre na sua conta e depois toque em Comprar novamente.");
      return;
    }
    if (outcome.status === "new_tab") {
      if (elements.paywall.open) elements.paywall.close();
      showToast("Checkout aberto em uma nova aba. Mantenha esta página aberta.");
      return;
    }
    if (outcome.status === "failed") {
      showToast("Não conseguimos abrir o checkout agora. Verifique sua conexão e tente novamente.");
    }
  } catch (error) {
    showToast(getCheckoutErrorMessage(error));
  }
}

function handleCheckoutReturn() {
  const { status, cleanedUrl } = sanitizeCheckoutReturn(window.location.href);
  if (!status) return;

  const messages = {
    success: "Você voltou do checkout de teste. Aguardando o webhook confirmar o pagamento antes de liberar o saldo.",
    pending: "O pagamento de teste está pendente. Nenhuma análise foi liberada ainda.",
    failure: "O pagamento de teste não foi concluído. Nenhuma análise foi liberada."
  };
  showToast(messages[status] ?? "Você voltou do checkout de teste.", 7000);
  replaceCheckoutReturn(window.history, cleanedUrl);
  if (status === "success" || status === "pending") {
    for (const delay of [2000, 6000, 15000, 30000, 60000, 120000, 300000]) {
      window.setTimeout(() => refreshCreditEntitlement(), delay);
    }
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const hash = elements.hash.value.trim();
  elements.error.textContent = "";
  elements.hash.setAttribute("aria-invalid", "false");
  elements.hash.closest(".input-shell").classList.remove("has-error");

  if (!isTransactionHash(hash)) {
    elements.error.textContent = "Cole um hash válido com 0x seguido por 64 caracteres.";
    elements.hash.setAttribute("aria-invalid", "true");
    elements.hash.closest(".input-shell").classList.add("has-error");
    elements.hash.focus();
    return;
  }

  await runAnalysis(
    hash,
    elements.network.value,
    setLoading,
    (message) => {
      elements.error.textContent = message;
    }
  );
});

elements.hash.addEventListener("input", () => {
  if (!elements.error.textContent) return;
  elements.error.textContent = "";
  elements.hash.setAttribute("aria-invalid", "false");
  elements.hash.closest(".input-shell").classList.remove("has-error");
});

elements.walletToggle.addEventListener("click", () => {
  const willOpen = elements.walletPanel.hidden;
  elements.walletPanel.hidden = !willOpen;
  elements.walletToggle.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) elements.walletAddress.focus();
});

elements.walletForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (analysisInProgress || walletSearchInProgress) return;

  const address = elements.walletAddress.value.trim();
  elements.walletError.textContent = "";
  elements.walletAddress.setAttribute("aria-invalid", "false");
  elements.walletAddress.closest(".input-shell").classList.remove("has-error");

  if (!isWalletAddress(address)) {
    elements.walletError.textContent = "Cole um endereço EVM válido com 0x seguido por 40 caracteres.";
    elements.walletAddress.setAttribute("aria-invalid", "true");
    elements.walletAddress.closest(".input-shell").classList.add("has-error");
    elements.walletAddress.focus();
    return;
  }

  walletSearchInProgress = true;
  setWalletLoading(true);
  setAnalysisControlsDisabled(true);
  elements.walletResults.hidden = true;
  elements.walletResults.setAttribute("aria-busy", "true");
  elements.transactionList.replaceChildren();
  currentWalletHistory = null;
  try {
    currentWalletHistory = await findRecentTransactions(
      address,
      elements.walletNetwork.value,
      getWalletHistoryLimit()
    );
    renderWalletHistory(currentWalletHistory);
  } catch (error) {
    elements.walletResults.hidden = true;
    elements.walletError.textContent = error.message;
  } finally {
    walletSearchInProgress = false;
    setWalletLoading(false);
    setAnalysisControlsDisabled(false);
    elements.walletResults.setAttribute("aria-busy", "false");
  }
});

elements.walletAddress.addEventListener("input", () => {
  if (!elements.walletError.textContent) return;
  elements.walletError.textContent = "";
  elements.walletAddress.setAttribute("aria-invalid", "false");
  elements.walletAddress.closest(".input-shell").classList.remove("has-error");
});

elements.walletSort.addEventListener("change", () => {
  if (currentWalletHistory) renderWalletHistory(currentWalletHistory, false);
});

elements.demoButton.addEventListener("click", () => showResult(createDemoAnalysis(), true));
elements.priceUnlock.addEventListener("click", beginCheckout);
elements.dialogUnlock.addEventListener("click", beginCheckout);
window.addEventListener("pageshow", () => {
  checkoutLoading.restoreAfterPageShow();
});
window.addEventListener("focus", () => {
  if (!IS_LOCAL_DEMO) refreshCreditEntitlement();
});
elements.closeDialog.addEventListener("click", () => elements.paywall.close());
elements.laterButton.addEventListener("click", () => elements.paywall.close());
elements.paywall.addEventListener("click", (event) => {
  if (event.target === elements.paywall) elements.paywall.close();
});
elements.fieldHelpClose.addEventListener("click", () => elements.fieldHelpDialog.close());
elements.fieldHelpConfirm.addEventListener("click", () => elements.fieldHelpDialog.close());
elements.fieldHelpDialog.addEventListener("click", (event) => {
  if (event.target === elements.fieldHelpDialog) elements.fieldHelpDialog.close();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let isReloadingForUpdate = false;

    if (hadController) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (isReloadingForUpdate) return;
        isReloadingForUpdate = true;
        window.location.reload();
      });
    }

    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      await registration.update();
    } catch {
      // O app continua funcional online mesmo se o navegador bloquear a PWA.
    }
  });
}

handleCheckoutReturn();
updateConfiguredCopy();
updateUsageLabel();
updateWalletLimitLabel();
updatePurchaseAvailability();
authControllerPromise = initAuthController({ onSessionChange: refreshCreditEntitlement });
