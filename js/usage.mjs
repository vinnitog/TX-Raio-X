const STORAGE_KEY = "tx-raio-x:usage:v1";

export function defaultUsage() {
  return { used: 0, unlocked: false };
}

export function readUsage(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return {
      used: Number.isInteger(saved?.used) && saved.used >= 0 ? saved.used : 0,
      unlocked: saved?.unlocked === true
    };
  } catch {
    return defaultUsage();
  }
}

export function writeUsage(storage, usage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(usage));
  return usage;
}

export function consumeAnalysis(storage, unlimited = false) {
  const usage = readUsage(storage);
  if (unlimited) return usage;
  if (!usage.unlocked) usage.used += 1;
  return writeUsage(storage, usage);
}

export function unlockBeta(storage) {
  const usage = readUsage(storage);
  usage.unlocked = true;
  return writeUsage(storage, usage);
}

export function getRemaining(usage, freeLimit, unlimited = false) {
  if (unlimited || usage.unlocked) return Infinity;
  return Math.max(0, freeLimit - usage.used);
}

export function getHistoryLimit(usage, freeLimit, unlockedLimit) {
  return usage.unlocked ? unlockedLimit : freeLimit;
}
