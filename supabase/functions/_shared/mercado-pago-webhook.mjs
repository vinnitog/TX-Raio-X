const PAYMENT_ID_PATTERN = /^\d{1,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCEPTED_STATUSES = new Set([
  "approved",
  "authorized",
  "cancelled",
  "charged_back",
  "in_mediation",
  "in_process",
  "pending",
  "refunded",
  "rejected"
]);

export class WebhookHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parseBooleanConfig(value, name = "boolean config") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function validateWebhookConfig(config) {
  if (config.environment !== "test") {
    throw new Error("Webhook production is disabled until the production review is complete.");
  }
  if (!config.webhookSecret) throw new Error("Missing webhook signature secret.");
  if (typeof config.paymentLiveMode !== "boolean") {
    throw new Error("MERCADO_PAGO_PAYMENT_LIVE_MODE must be true or false.");
  }
  if (!PAYMENT_ID_PATTERN.test(config.collectorId ?? "")) {
    throw new Error("MERCADO_PAGO_COLLECTOR_ID must contain only digits.");
  }
}

export function parseSignature(value) {
  const parts = new Map();
  for (const rawPart of String(value ?? "").split(",")) {
    const separator = rawPart.indexOf("=");
    if (separator < 1) continue;
    const key = rawPart.slice(0, separator).trim();
    const partValue = rawPart.slice(separator + 1).trim().toLowerCase();
    if ((key === "ts" || key === "v1") && parts.has(key)) {
      throw new WebhookHttpError(401, "invalid_signature", "Duplicate signature field.");
    }
    parts.set(key, partValue);
  }

  const ts = parts.get("ts") ?? "";
  const v1 = parts.get("v1") ?? "";
  if (!/^\d{1,20}$/.test(ts) || !/^[0-9a-f]{64}$/.test(v1)) {
    throw new WebhookHttpError(401, "invalid_signature", "Malformed signature.");
  }
  return { ts, v1 };
}

export function buildSignatureManifest(dataId, requestId, timestamp) {
  return `id:${dataId};request-id:${requestId};ts:${timestamp};`;
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
}

export async function verifyMercadoPagoSignature({ dataId, requestId, signature, secret }) {
  if (!PAYMENT_ID_PATTERN.test(dataId ?? "") || !requestId || requestId.length > 200) {
    return false;
  }
  const { ts, v1 } = parseSignature(signature);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(v1),
    encoder.encode(buildSignatureManifest(dataId, requestId, ts))
  );
}

export function amountToCents(value, fieldName = "amount") {
  const amount = typeof value === "number" ? value : Number(value);
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(scaled - cents) > 1e-7) {
    throw new WebhookHttpError(422, "invalid_payment_snapshot", `${fieldName} is invalid.`);
  }
  return cents;
}

export function normalizePayment(payment, notificationId, collectorId, expectedLiveMode) {
  if ((typeof payment?.id === "number" && !Number.isSafeInteger(payment.id))
    || (typeof payment?.collector_id === "number" && !Number.isSafeInteger(payment.collector_id))
    || (typeof payment?.order?.id === "number" && !Number.isSafeInteger(payment.order.id))) {
    throw new WebhookHttpError(422, "unsafe_provider_id", "Provider returned an unsafe numeric ID.");
  }
  const paymentId = String(payment?.id ?? "");
  const orderId = String(payment?.external_reference ?? "").trim();
  const status = String(payment?.status ?? "").trim().toLowerCase();

  if (paymentId !== notificationId || !PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new WebhookHttpError(422, "payment_id_mismatch", "Payment ID does not match notification.");
  }
  if (payment?.live_mode !== expectedLiveMode) {
    throw new WebhookHttpError(422, "live_mode_mismatch", "Payment live mode does not match configuration.");
  }
  if (String(payment?.collector_id ?? "") !== collectorId) {
    throw new WebhookHttpError(422, "collector_mismatch", "Payment belongs to another collector.");
  }
  if (!UUID_PATTERN.test(orderId)) {
    throw new WebhookHttpError(422, "invalid_external_reference", "Payment has no valid order reference.");
  }
  if (!ACCEPTED_STATUSES.has(status)) {
    throw new WebhookHttpError(422, "unsupported_payment_status", "Payment status is unsupported.");
  }

  const merchantOrderId = String(payment?.order?.id ?? "");
  if (!PAYMENT_ID_PATTERN.test(merchantOrderId) || payment?.order?.type !== "mercadopago") {
    throw new WebhookHttpError(422, "invalid_merchant_order", "Payment has no valid merchant order.");
  }

  const amountCents = amountToCents(payment?.transaction_amount, "transaction_amount");
  const refundedCents = amountToCents(
    payment?.transaction_amount_refunded ?? 0,
    "transaction_amount_refunded"
  );
  if (amountCents <= 0 || refundedCents > amountCents) {
    throw new WebhookHttpError(422, "invalid_payment_snapshot", "Payment amounts are inconsistent.");
  }

  let approvedAt = null;
  if (payment?.date_approved) {
    const parsed = new Date(payment.date_approved);
    if (Number.isNaN(parsed.valueOf())) {
      throw new WebhookHttpError(422, "invalid_payment_snapshot", "Approval date is invalid.");
    }
    approvedAt = parsed.toISOString();
  }

  const providerUpdatedAt = new Date(payment?.date_last_updated);
  if (Number.isNaN(providerUpdatedAt.valueOf())) {
    throw new WebhookHttpError(422, "invalid_payment_snapshot", "Payment update date is invalid.");
  }

  return {
    orderId,
    providerPaymentId: paymentId,
    status,
    statusDetail: String(payment?.status_detail ?? "").slice(0, 120) || null,
    amountCents,
    refundedCents,
    currency: String(payment?.currency_id ?? "").toUpperCase(),
    approvedAt,
    providerUpdatedAt: providerUpdatedAt.toISOString(),
    merchantOrderId
  };
}

export function validatePaymentAgainstOrder(payment, order) {
  if (!order || order.id !== payment.orderId) {
    throw new WebhookHttpError(404, "order_not_found", "Payment order was not found.");
  }
  if (order.provider !== "mercado_pago"
    || typeof order.provider_preference_id !== "string"
    || !order.provider_preference_id
    || order.amount_cents !== payment.amountCents
    || order.currency !== payment.currency) {
    throw new WebhookHttpError(422, "order_payment_mismatch", "Payment does not match order snapshot.");
  }
}

export function validateMerchantOrder(merchantOrder, payment, order) {
  if ((typeof merchantOrder?.id === "number" && !Number.isSafeInteger(merchantOrder.id))
    || merchantOrder?.payments?.some((item) =>
      typeof item?.id === "number" && !Number.isSafeInteger(item.id))) {
    throw new WebhookHttpError(422, "unsafe_provider_id", "Provider returned an unsafe numeric ID.");
  }
  const paymentIds = Array.isArray(merchantOrder?.payments)
    ? merchantOrder.payments.map((item) => String(item?.id ?? ""))
    : [];
  if (String(merchantOrder?.id ?? "") !== payment.merchantOrderId
    || merchantOrder?.preference_id !== order.provider_preference_id
    || merchantOrder?.external_reference !== order.id
    || !paymentIds.includes(payment.providerPaymentId)) {
    throw new WebhookHttpError(422, "merchant_order_mismatch", "Payment is not linked to the checkout preference.");
  }
}

function jsonResponse(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createMercadoPagoWebhookHandler({
  loadConfig,
  verifySignature = verifyMercadoPagoSignature,
  fetchPayment,
  fetchMerchantOrder,
  loadOrder,
  processPayment,
  logger = console
}) {
  return async function handleMercadoPagoWebhook(request) {
    try {
      if (request.method !== "POST") {
        throw new WebhookHttpError(405, "method_not_allowed", "Use POST.");
      }
      const config = loadConfig();
      validateWebhookConfig(config);

      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 16384) {
        throw new WebhookHttpError(413, "request_too_large", "Webhook request is too large.");
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 16384) {
        throw new WebhookHttpError(413, "request_too_large", "Webhook request is too large.");
      }
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new WebhookHttpError(400, "invalid_json", "Webhook body must be JSON.");
      }

      const url = new URL(request.url);
      const dataId = url.searchParams.get("data.id") ?? "";
      if (!dataId && body && typeof body === "object"
        && !Array.isArray(body) && Object.keys(body).length === 0
        && [...url.searchParams].length === 0
        && !request.headers.has("x-signature")
        && !request.headers.has("x-request-id")) {
        return jsonResponse({ received: true, ignored: true, probe: true }, 200);
      }
      const bodyDataId = String(body?.data?.id ?? "");
      if (!PAYMENT_ID_PATTERN.test(dataId) || bodyDataId !== dataId) {
        throw new WebhookHttpError(400, "notification_id_mismatch", "Notification ID is invalid.");
      }

      const requestId = request.headers.get("x-request-id") ?? "";
      const signature = request.headers.get("x-signature") ?? "";
      const signatureIsValid = await verifySignature({
        dataId,
        requestId,
        signature,
        secret: config.webhookSecret
      });
      if (!signatureIsValid) {
        throw new WebhookHttpError(401, "invalid_signature", "Webhook signature is invalid.");
      }

      if (body?.type !== "payment") {
        return jsonResponse({ received: true, ignored: true }, 200);
      }

      const payment = normalizePayment(
        await fetchPayment(dataId),
        dataId,
        config.collectorId,
        config.paymentLiveMode
      );
      const order = await loadOrder(payment.orderId);
      validatePaymentAgainstOrder(payment, order);
      validateMerchantOrder(
        await fetchMerchantOrder(payment.merchantOrderId),
        payment,
        order
      );
      const result = await processPayment(payment);

      return jsonResponse({
        received: true,
        credited: Boolean(result?.credited),
        reversed: Boolean(result?.reversed)
      }, 200);
    } catch (error) {
      const status = error instanceof WebhookHttpError ? error.status : 500;
      const code = error instanceof WebhookHttpError ? error.code : "internal_error";
      logger.error("mercado_pago_webhook_error", {
        code,
        message: String(error?.message ?? error).slice(0, 200)
      });
      return jsonResponse({ error: code }, status);
    }
  };
}
