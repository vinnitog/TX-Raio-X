const CHECKOUT_ATTEMPT_KEY = "txraiox_checkout_attempt_v1";
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

function readAttempt(storage, userId) {
  try {
    const saved = JSON.parse(storage?.getItem(CHECKOUT_ATTEMPT_KEY) ?? "null");
    if (saved?.userId === userId && UUID_V4_PATTERN.test(saved?.idempotencyKey ?? "")) {
      return saved.idempotencyKey;
    }
  } catch {
    // A tentativa continua em memória quando o navegador bloqueia sessionStorage.
  }
  return null;
}

function writeAttempt(storage, userId, idempotencyKey) {
  try {
    storage?.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify({ userId, idempotencyKey }));
  } catch {
    // A criação do checkout não depende da disponibilidade do armazenamento local.
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
  let memoryAttempt = null;

  return Object.freeze({
    async start() {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      const session = sessionData?.session;
      if (sessionError || !session?.user?.id) return { status: "auth_required" };

      const userId = session.user.id;
      let idempotencyKey = readAttempt(storage, userId);
      if (!idempotencyKey && memoryAttempt?.userId === userId) {
        idempotencyKey = memoryAttempt.idempotencyKey;
      }
      if (!idempotencyKey) {
        idempotencyKey = createId();
        if (!UUID_V4_PATTERN.test(idempotencyKey)) {
          throw new CheckoutClientError("idempotency_unavailable");
        }
        memoryAttempt = { userId, idempotencyKey };
        writeAttempt(storage, userId, idempotencyKey);
      }

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
