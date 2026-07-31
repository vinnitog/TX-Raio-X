const LEGACY_CHECKOUT_ATTEMPT_KEY = "txraiox_checkout_attempt_v1";
const CHECKOUT_ATTEMPTS_KEY = "txraiox_checkout_attempts_v2";
const PACKAGE_CODE = "analysis_pack_10";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEST_CHECKOUT_HOSTS = new Set([
  "sandbox.mercadopago.com",
  "sandbox.mercadopago.com.br"
]);

export class CheckoutClientError extends Error {
  constructor(code = "checkout_unavailable") {
    super(code);
    this.code = code;
  }
}

function isValidAttempt(attempt) {
  return typeof attempt?.userId === "string"
    && attempt.userId
    && UUID_V4_PATTERN.test(attempt?.idempotencyKey ?? "");
}

function readAttempts(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(CHECKOUT_ATTEMPTS_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    const byUser = new Map();
    for (const attempt of saved.filter(isValidAttempt)) {
      byUser.delete(attempt.userId);
      byUser.set(attempt.userId, attempt);
    }
    return [...byUser.values()];
  } catch {
    return [];
  }
}

function writeAttempt(storage, userId, idempotencyKey) {
  try {
    const attempts = readAttempts(storage).filter((attempt) => attempt.userId !== userId);
    attempts.push({ userId, idempotencyKey });
    storage?.setItem(CHECKOUT_ATTEMPTS_KEY, JSON.stringify(attempts));
    return true;
  } catch {
    // A criação do checkout não depende da disponibilidade do armazenamento local.
    return false;
  }
}

function readAttempt(storage, userId) {
  const saved = readAttempts(storage).find((attempt) => attempt.userId === userId);
  if (saved) return saved.idempotencyKey;

  try {
    const legacy = JSON.parse(storage?.getItem(LEGACY_CHECKOUT_ATTEMPT_KEY) ?? "null");
    if (legacy?.userId === userId && isValidAttempt(legacy)) {
      if (writeAttempt(storage, userId, legacy.idempotencyKey)) {
        try {
          storage?.removeItem?.(LEGACY_CHECKOUT_ATTEMPT_KEY);
        } catch {
          // A cópia v2 já preserva a tentativa mesmo se a limpeza falhar.
        }
      }
      return legacy.idempotencyKey;
    }
  } catch {
    // A tentativa continua em memória quando o navegador bloqueia o armazenamento.
  }
  return null;
}

async function getFunctionErrorCode(error) {
  try {
    const payload = await error?.context?.clone?.().json();
    return typeof payload?.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

function validateCheckoutResponse(data) {
  let checkoutUrl;
  try {
    checkoutUrl = new URL(data?.checkoutUrl);
  } catch {
    throw new CheckoutClientError("invalid_checkout_response");
  }

  if (
    data?.environment !== "test"
    || typeof data?.orderId !== "string"
    || !data.orderId
    || checkoutUrl.protocol !== "https:"
    || !TEST_CHECKOUT_HOSTS.has(checkoutUrl.hostname)
  ) {
    throw new CheckoutClientError("invalid_checkout_response");
  }
  return { orderId: data.orderId, checkoutUrl: checkoutUrl.toString() };
}

export function createCheckoutClient(client, {
  storage = globalThis.localStorage,
  createId = () => globalThis.crypto.randomUUID()
} = {}) {
  const memoryAttempts = new Map();

  return Object.freeze({
    async start() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const session = sessionData?.session;
      if (sessionError || !session?.user?.id) return { status: "auth_required" };

      const userId = session.user.id;
      let idempotencyKey = readAttempt(storage, userId);
      if (!idempotencyKey) idempotencyKey = memoryAttempts.get(userId) ?? null;
      if (!idempotencyKey) {
        idempotencyKey = createId();
        if (!UUID_V4_PATTERN.test(idempotencyKey)) {
          throw new CheckoutClientError("idempotency_unavailable");
        }
      }
      memoryAttempts.set(userId, idempotencyKey);
      writeAttempt(storage, userId, idempotencyKey);

      const { data, error } = await client.functions.invoke("checkout", {
        body: { packageCode: PACKAGE_CODE },
        headers: { "Idempotency-Key": idempotencyKey }
      });
      if (error) {
        const code = await getFunctionErrorCode(error);
        throw new CheckoutClientError(code ?? "checkout_unavailable");
      }

      const checkout = validateCheckoutResponse(data);
      return { status: "ready", ...checkout };
    }
  });
}
