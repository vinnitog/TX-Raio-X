const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const PENDING_CONSUMPTIONS_KEY = "txraiox_pending_credit_consumptions_v1";
const EXPLORER_HOSTS = new Set([
  "etherscan.io", "basescan.org", "arbiscan.io", "polygonscan.com", "bscscan.com"
]);

export class CreditClientError extends Error {
  constructor(code = "credits_unavailable") {
    super(code);
    this.code = code;
  }
}

async function getFunctionErrorCode(error) {
  try {
    const payload = await error?.context?.clone?.().json();
    return typeof payload?.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

function normalizeEntitlement(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const balance = Number(row?.balance);
  const freeRemaining = Number(row?.free_remaining);
  if (!Number.isSafeInteger(balance) || balance < 0
    || !Number.isSafeInteger(freeRemaining) || freeRemaining < 0
    || typeof row?.has_paid_access !== "boolean") {
    throw new CreditClientError("invalid_entitlement_response");
  }
  return { balance, freeRemaining, hasPaidAccess: row.has_paid_access };
}

function normalizeConsumption(data) {
  if (data?.consumed !== true
    || typeof data?.applied !== "boolean"
    || !Number.isSafeInteger(data?.balance)
    || data.balance < 0
    || !Number.isSafeInteger(data?.freeRemaining)
    || data.freeRemaining < 0
    || !["free", "paid"].includes(data?.source)) {
    throw new CreditClientError("invalid_consumption_response");
  }
  return {
    balance: data.balance,
    freeRemaining: data.freeRemaining,
    source: data.source,
    applied: data.applied
  };
}

function normalizeProtectedAnalysis(data) {
  const analysis = data?.analysis;
  const entitlement = data?.entitlement;
  const consumption = data?.consumption;
  let explorerUrl;
  try { explorerUrl = new URL(analysis?.explorerUrl); } catch { explorerUrl = null; }
  const validDetails = (items) => Array.isArray(items) && items.every((item) =>
    typeof item?.label === "string" && typeof item?.value === "string");
  const validMessages = (items, fields) => Array.isArray(items) && items.every((item) =>
    fields.every((field) => typeof item?.[field] === "string"));
  if (!analysis || typeof analysis.title !== "string" || typeof analysis.summary !== "string"
    || typeof analysis.nextStep !== "string" || typeof analysis.status?.label !== "string"
    || !["success", "warning", "danger"].includes(analysis.status?.tone)
    || !validDetails(analysis.details) || !validDetails(analysis.decodedFields)
    || !validDetails(analysis.technicalDetails)
    || !validMessages(analysis.movements, ["type", "summary", "details"])
    || !validMessages(analysis.alerts, ["title", "text"])
    || explorerUrl?.protocol !== "https:" || !EXPLORER_HOSTS.has(explorerUrl.hostname)
    || !Number.isSafeInteger(entitlement?.balance) || entitlement.balance < 0
    || !Number.isSafeInteger(entitlement?.freeRemaining) || entitlement.freeRemaining < 0
    || !["free", "paid"].includes(consumption?.source)
    || typeof consumption?.applied !== "boolean") {
    throw new CreditClientError("invalid_analysis_response");
  }
  return { analysis, entitlement, consumption };
}

export function createCreditClient(client, {
  createId = () => globalThis.crypto.randomUUID(),
  storage = globalThis.sessionStorage
} = {}) {
  const memoryPending = new Map();

  function readPending() {
    try {
      const saved = JSON.parse(storage?.getItem(PENDING_CONSUMPTIONS_KEY) ?? "[]");
      if (!Array.isArray(saved)) return [];
      return saved.filter((entry) =>
        typeof entry?.userId === "string"
        && entry.userId
        && UUID_V4_PATTERN.test(entry.analysisId ?? "")
        && FINGERPRINT_PATTERN.test(entry.fingerprint ?? ""));
    } catch {
      return [];
    }
  }

  function writePending(entries) {
    try {
      storage?.setItem(PENDING_CONSUMPTIONS_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  function removePending(userId, analysisId) {
    memoryPending.delete(userId);
    writePending(readPending().filter((entry) =>
      entry.userId !== userId || entry.analysisId !== analysisId));
  }

  async function getSession(expectedUserId = null) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.user?.id) {
      throw new CreditClientError("authentication_required");
    }
    if (expectedUserId && data.session.user.id !== expectedUserId) {
      throw new CreditClientError("account_changed");
    }
    return data.session;
  }

  function prepareAnalysisAttempt(userId, fingerprint) {
    if (typeof userId !== "string" || !userId || !FINGERPRINT_PATTERN.test(fingerprint ?? "")) {
      throw new CreditClientError("invalid_analysis_attempt");
    }
    const persisted = readPending().find((entry) => entry.userId === userId);
    const existing = persisted ?? memoryPending.get(userId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new CreditClientError("consumption_reconciliation_required");
      }
      memoryPending.set(userId, existing);
      return existing.analysisId;
    }

    const analysisId = createId();
    if (!UUID_V4_PATTERN.test(analysisId ?? "")) {
      throw new CreditClientError("idempotency_unavailable");
    }
    const pending = { userId, fingerprint, analysisId };
    memoryPending.set(userId, pending);
    const pendingWasPersisted = writePending([
      ...readPending().filter((entry) => entry.userId !== userId),
      pending
    ]);
    if (!pendingWasPersisted) {
      memoryPending.delete(userId);
      throw new CreditClientError("idempotency_persistence_unavailable");
    }
    return analysisId;
  }

  return Object.freeze({
    async getEntitlement() {
      const session = await getSession();
      const { data, error } = await client.rpc("get_credit_entitlement");
      if (error) throw new CreditClientError("balance_unavailable");
      return { userId: session.user.id, ...normalizeEntitlement(data) };
    },

    prepareAnalysis(userId, fingerprint) {
      return prepareAnalysisAttempt(userId, fingerprint);
    },

    async analyze(hash, network, expectedUserId) {
      const session = await getSession(expectedUserId);
      const fingerprint = await fingerprintAnalysis(hash, network);
      const analysisId = prepareAnalysisAttempt(session.user.id, fingerprint);
      const { data, error } = await client.functions.invoke("analyze-transaction", {
        body: { analysisId, hash: hash.toLowerCase(), network }
      });
      if (error) {
        const code = await getFunctionErrorCode(error);
        if ([
          "invalid_request", "transaction_not_found", "unsupported_network",
          "credits_exhausted", "analysis_conflict"
        ].includes(code)) {
          removePending(session.user.id, analysisId);
        }
        throw new CreditClientError(code ?? "analysis_unavailable");
      }
      const result = normalizeProtectedAnalysis(data);
      removePending(session.user.id, analysisId);
      return result;
    },

    async consume(analysisId, expectedUserId) {
      if (!UUID_V4_PATTERN.test(analysisId ?? "")) {
        throw new CreditClientError("idempotency_unavailable");
      }
      await getSession(expectedUserId);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await client.functions.invoke("consume-analysis", {
          body: { analysisId }
        });
        if (!error) {
          const consumption = normalizeConsumption(data);
          removePending(expectedUserId, analysisId);
          return consumption;
        }

        const code = await getFunctionErrorCode(error);
        const outcomeIsUncertain = !code || code === "internal_error";
        if (!outcomeIsUncertain || attempt === 1) {
          if (code === "credits_exhausted") removePending(expectedUserId, analysisId);
          throw new CreditClientError(code ?? "credits_unavailable");
        }
      }
      throw new CreditClientError("credits_unavailable");
    }
  });
}

export async function fingerprintAnalysis(hash, networkId) {
  const normalizedHash = String(hash ?? "").trim().toLowerCase();
  const normalizedNetwork = String(networkId ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalizedHash) || !/^[a-z0-9_-]{1,40}$/.test(normalizedNetwork)) {
    throw new CreditClientError("invalid_analysis_attempt");
  }
  const bytes = new TextEncoder().encode(`${normalizedNetwork}:${normalizedHash}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
