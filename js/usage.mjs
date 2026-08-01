const STORAGE_KEY = "tx-raio-x:usage:v1";

export function defaultUsage() {
  return {
    used: 0,
    credits: 0,
    paid: false,
    unlocked: false,
    appliedGrants: []
  };
}

export function readUsage(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    const unlocked = saved?.unlocked === true;
    return {
      used: Number.isInteger(saved?.used) && saved.used >= 0 ? saved.used : 0,
      credits: Number.isInteger(saved?.credits) && saved.credits >= 0 ? saved.credits : 0,
      paid: saved?.paid === true || unlocked,
      unlocked,
      appliedGrants: Array.isArray(saved?.appliedGrants)
        ? [...new Set(saved.appliedGrants.filter((id) => typeof id === "string" && id))]
        : []
    };
  } catch {
    return defaultUsage();
  }
}

export function writeUsage(storage, usage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(usage));
  return usage;
}

export function consumeAnalysis(storage, freeLimit, unlimited = false) {
  const usage = readUsage(storage);
  if (unlimited) return usage;
  if (usage.unlocked) return usage;
  if (getFreeRemaining(usage, freeLimit) > 0) {
    usage.used += 1;
  } else if (usage.credits > 0) {
    usage.credits -= 1;
  }
  return writeUsage(storage, usage);
}

// Mantém compatibilidade com direitos adquiridos durante o beta ilimitado anterior.
export function unlockBeta(storage) {
  const usage = readUsage(storage);
  usage.unlocked = true;
  usage.paid = true;
  return writeUsage(storage, usage);
}

export function addCredits(storage, amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TypeError("A quantidade de créditos deve ser um inteiro positivo.");
  }

  const usage = readUsage(storage);
  usage.credits += amount;
  usage.paid = true;
  return writeUsage(storage, usage);
}

export function applyCreditGrant(storage, grantId, amount) {
  if (typeof grantId !== "string" || !grantId.trim()) {
    throw new TypeError("O identificador do pagamento é obrigatório.");
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TypeError("A quantidade de créditos deve ser um inteiro positivo.");
  }

  const normalizedGrantId = grantId.trim();
  const usage = readUsage(storage);
  if (usage.appliedGrants.includes(normalizedGrantId)) {
    return { usage, applied: false };
  }

  usage.credits += amount;
  usage.paid = true;
  usage.appliedGrants = [...usage.appliedGrants, normalizedGrantId];
  return { usage: writeUsage(storage, usage), applied: true };
}

export function getFreeRemaining(usage, freeLimit) {
  return Math.max(0, freeLimit - usage.used);
}

export function getRemaining(usage, freeLimit, unlimited = false) {
  if (unlimited || usage.unlocked) return Infinity;
  return getFreeRemaining(usage, freeLimit) + usage.credits;
}

export function getHistoryLimit(usage, freeLimit, unlockedLimit) {
  return usage.paid || usage.unlocked ? unlockedLimit : freeLimit;
}

export function formatUsageSummary({
  freeRemaining,
  balance = 0,
  balanceStatus = "guest",
  localCredits = 0,
  localDemo = false,
  unlocked = false
}) {
  if (unlocked) return "Acesso legado ilimitado";

  const paidBalance = localDemo
    ? localCredits
    : balanceStatus === "ready" ? balance : 0;
  const freeLabel = `${freeRemaining} grátis`;

  if (paidBalance > 0 && freeRemaining > 0) {
    return `Saldo: ${paidBalance} + ${freeLabel}`;
  }
  if (paidBalance > 0) {
    return `Saldo: ${paidBalance} ${paidBalance === 1 ? "análise" : "análises"}`;
  }
  if (!localDemo && balanceStatus === "loading") {
    return freeRemaining > 0 ? `${freeLabel} · carregando saldo…` : "Carregando saldo…";
  }
  if (!localDemo && balanceStatus === "error") {
    return freeRemaining > 0 ? `${freeLabel} · saldo indisponível` : "Saldo indisponível";
  }
  if (freeRemaining > 0) {
    return `${freeRemaining} ${freeRemaining === 1 ? "análise grátis" : "análises grátis"}`;
  }
  return "Análises extras esgotadas";
}
