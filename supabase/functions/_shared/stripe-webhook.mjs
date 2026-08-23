import { createRequestTelemetry, getRequestId, withRequestId } from "./observability.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERNS = Object.freeze({
  event: /^evt_[A-Za-z0-9]{8,255}$/,
  session: /^cs_(?:test|live)_[A-Za-z0-9]{8,255}$/,
  paymentIntent: /^pi_[A-Za-z0-9]{8,255}$/,
  charge: /^ch_[A-Za-z0-9]{8,255}$/,
  price: /^price_[A-Za-z0-9]{8,255}$/
});
export const HANDLED_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created"
]);

export class WebhookHttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function validateStripeId(value, type) {
  const normalized = String(value ?? "");
  if (!ID_PATTERNS[type]?.test(normalized)) throw new WebhookHttpError(422, "invalid_provider_snapshot", `Invalid Stripe ${type}.`);
  return normalized;
}

export function validateStripeWebhookConfig(config) {
  if (config.environment !== "test") throw new Error("Stripe webhook production is disabled.");
  if (!String(config.webhookSecret ?? "").startsWith("whsec_") || String(config.webhookSecret).length < 20) throw new Error("STRIPE_WEBHOOK_SECRET is invalid.");
}

function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyStripeWebhookSignature({ rawBody, signatureHeader, secret, now = Date.now(), toleranceSeconds = 300 }) {
  const entries = String(signatureHeader ?? "").split(",").map((part) => part.trim());
  const timestamps = entries.filter((part) => part.startsWith("t=")).map((part) => part.slice(2));
  const signatures = entries.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  const timestamp = Number(timestamps[0]);
  if (timestamps.length !== 1 || !Number.isInteger(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret ?? "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return signatures.some((signature) => constantTimeEqual(expected, hexToBytes(signature)));
}

function objectId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function eventDate(event) {
  const seconds = Number(event?.created);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new WebhookHttpError(400, "invalid_event", "Invalid Stripe event timestamp.");
  return new Date(seconds * 1000).toISOString();
}

function assertCommonOrder(order, { orderId, amountCents, currency, environment }) {
  if (!order || order.id !== orderId || order.provider !== "stripe" || order.provider_environment !== environment
    || order.amount_cents !== amountCents || order.currency !== currency) {
    throw new WebhookHttpError(422, "order_payment_mismatch", "Stripe payment does not match order snapshot.");
  }
}

export function normalizePaidCheckoutSession(session, order, config, providerUpdatedAt) {
  const sessionId = validateStripeId(session?.id, "session");
  const paymentIntentId = validateStripeId(objectId(session?.payment_intent), "paymentIntent");
  const orderId = String(session?.client_reference_id ?? session?.metadata?.order_id ?? "");
  const lineItems = Array.isArray(session?.line_items?.data) ? session.line_items.data : [];
  const priceId = objectId(lineItems[0]?.price) ?? lineItems[0]?.price?.id;
  const amountCents = Number(session?.amount_total);
  const currency = String(session?.currency ?? "").toUpperCase();
  if (!UUID_PATTERN.test(orderId) || session?.mode !== "payment" || session?.status !== "complete"
    || session?.payment_status !== "paid" || lineItems.length !== 1 || Number(lineItems[0]?.quantity) !== 1
    || priceId !== order.provider_price_id || session?.metadata?.package_code !== order.package_code
    || session?.metadata?.order_id !== orderId || order.provider_checkout_session_id !== sessionId) {
    throw new WebhookHttpError(422, "invalid_checkout_snapshot", "Stripe checkout snapshot is invalid.");
  }
  assertCommonOrder(order, { orderId, amountCents, currency, environment: config.environment });
  return { orderId, providerPaymentId: paymentIntentId, status: "approved", statusDetail: "checkout_paid", amountCents, refundedCents: 0, currency, approvedAt: providerUpdatedAt, providerUpdatedAt };
}

export function normalizePaymentIntent(paymentIntent, order, config, providerUpdatedAt) {
  const providerPaymentId = validateStripeId(paymentIntent?.id, "paymentIntent");
  const orderId = String(paymentIntent?.metadata?.order_id ?? "");
  const amountCents = Number(paymentIntent?.amount);
  const currency = String(paymentIntent?.currency ?? "").toUpperCase();
  if (!UUID_PATTERN.test(orderId) || paymentIntent?.metadata?.package_code !== order.package_code
    || !["requires_payment_method", "canceled"].includes(paymentIntent?.status)) {
    throw new WebhookHttpError(422, "invalid_payment_snapshot", "Stripe payment snapshot is invalid.");
  }
  assertCommonOrder(order, { orderId, amountCents, currency, environment: config.environment });
  return { orderId, providerPaymentId, status: "rejected", statusDetail: String(paymentIntent?.last_payment_error?.code ?? paymentIntent?.status).slice(0, 120), amountCents, refundedCents: 0, currency, approvedAt: null, providerUpdatedAt };
}

export function validateExpiredCheckoutSession(session, order, config) {
  const sessionId = validateStripeId(session?.id, "session");
  const orderId = String(session?.client_reference_id ?? session?.metadata?.order_id ?? "");
  const lineItems = Array.isArray(session?.line_items?.data) ? session.line_items.data : [];
  const priceId = objectId(lineItems[0]?.price) ?? lineItems[0]?.price?.id;
  if (!UUID_PATTERN.test(orderId) || session?.mode !== "payment" || session?.status !== "expired"
    || session?.payment_status !== "unpaid" || lineItems.length !== 1 || Number(lineItems[0]?.quantity) !== 1
    || priceId !== order.provider_price_id || session?.metadata?.order_id !== orderId
    || session?.metadata?.package_code !== order.package_code
    || order.provider_checkout_session_id !== sessionId) {
    throw new WebhookHttpError(422, "invalid_checkout_snapshot", "Expired Stripe checkout snapshot is invalid.");
  }
  assertCommonOrder(order, {
    orderId,
    amountCents: Number(session?.amount_total),
    currency: String(session?.currency ?? "").toUpperCase(),
    environment: config.environment
  });
  return { orderId, sessionId };
}

export function normalizeStripeReversal(charge, paymentIntent, order, config, providerUpdatedAt, disputed) {
  validateStripeId(charge?.id, "charge");
  const providerPaymentId = validateStripeId(objectId(charge?.payment_intent), "paymentIntent");
  if (providerPaymentId !== paymentIntent?.id) throw new WebhookHttpError(422, "payment_reference_mismatch", "Stripe reversal has an invalid payment reference.");
  const orderId = String(paymentIntent?.metadata?.order_id ?? "");
  const amountCents = Number(charge?.amount);
  const refundedCents = disputed ? amountCents : Number(charge?.amount_refunded ?? 0);
  const currency = String(charge?.currency ?? "").toUpperCase();
  if (!UUID_PATTERN.test(orderId) || paymentIntent?.metadata?.package_code !== order.package_code
    || !Number.isInteger(refundedCents) || refundedCents < 0 || refundedCents > amountCents) {
    throw new WebhookHttpError(422, "invalid_reversal_snapshot", "Stripe reversal snapshot is invalid.");
  }
  assertCommonOrder(order, { orderId, amountCents, currency, environment: config.environment });
  const status = disputed ? "charged_back" : refundedCents === amountCents ? "refunded" : "partially_refunded";
  return { orderId, providerPaymentId, status, statusDetail: disputed ? "dispute_created" : "charge_refunded", amountCents, refundedCents, currency, approvedAt: null, providerUpdatedAt };
}

function jsonResponse(body, status, requestId) {
  return Response.json(body, { status, headers: withRequestId({ "Cache-Control": "no-store" }, requestId) });
}

export function createStripeWebhookHandler({ loadConfig, verifySignature = verifyStripeWebhookSignature, fetchStripe, loadOrder, processPayment, processExpiration, logger = console, now = () => Date.now() }) {
  return async function handleStripeWebhook(request) {
    const requestId = getRequestId(request);
    const telemetry = createRequestTelemetry(logger, "stripe_webhook_request", requestId, now);
    try {
      if (request.method !== "POST") throw new WebhookHttpError(405, "method_not_allowed", "Use POST.");
      const config = loadConfig();
      validateStripeWebhookConfig(config);
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) throw new WebhookHttpError(413, "request_too_large", "Webhook request is too large.");
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 1024 * 1024) throw new WebhookHttpError(413, "request_too_large", "Webhook request is too large.");
      if (!await verifySignature({ rawBody, signatureHeader: request.headers.get("Stripe-Signature"), secret: config.webhookSecret, now: now() })) throw new WebhookHttpError(400, "invalid_signature", "Webhook signature is invalid.");
      let event;
      try { event = JSON.parse(rawBody); } catch { throw new WebhookHttpError(400, "invalid_json", "Webhook body must be JSON."); }
      validateStripeId(event?.id, "event");
      if (event?.livemode !== false || config.environment !== "test") throw new WebhookHttpError(400, "environment_mismatch", "Stripe event environment does not match.");
      const eventType = String(event?.type ?? "");
      if (!HANDLED_STRIPE_EVENTS.has(eventType)) { telemetry.ignored({ code: "event_not_handled", status: 200 }); return jsonResponse({ received: true, ignored: true }, 200, requestId); }
      const providerUpdatedAt = eventDate(event);
      const eventObject = event?.data?.object ?? {};
      let payment;

      if (eventType.startsWith("checkout.session.")) {
        const sessionId = validateStripeId(eventObject.id, "session");
        const session = await fetchStripe(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items.data.price&expand[]=payment_intent`);
        if (eventType === "checkout.session.expired") {
          const orderId = String(session?.client_reference_id ?? session?.metadata?.order_id ?? "");
          const order = await loadOrder(orderId);
          const expired = validateExpiredCheckoutSession(session, order, config);
          await processExpiration(expired, { eventId: event.id, eventType, environment: config.environment, providerUpdatedAt });
          telemetry.success({ status: 200, credited: false, reversed: false });
          return jsonResponse({ received: true, credited: false, reversed: false }, 200, requestId);
        }
        if (eventType === "checkout.session.completed" && session?.payment_status !== "paid") {
          telemetry.ignored({ code: "payment_pending", status: 200 });
          return jsonResponse({ received: true, credited: false, reversed: false }, 200, requestId);
        }
        if (eventType === "checkout.session.async_payment_failed") {
          const paymentIntentId = validateStripeId(objectId(session?.payment_intent), "paymentIntent");
          const intent = await fetchStripe(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
          const order = await loadOrder(String(intent?.metadata?.order_id ?? ""));
          payment = normalizePaymentIntent(intent, order, config, providerUpdatedAt);
        } else {
          const orderId = String(session?.client_reference_id ?? session?.metadata?.order_id ?? "");
          const order = await loadOrder(orderId);
          payment = normalizePaidCheckoutSession(session, order, config, providerUpdatedAt);
        }
      } else if (eventType === "payment_intent.payment_failed") {
        const paymentIntentId = validateStripeId(eventObject.id, "paymentIntent");
        const intent = await fetchStripe(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
        const order = await loadOrder(String(intent?.metadata?.order_id ?? ""));
        payment = normalizePaymentIntent(intent, order, config, providerUpdatedAt);
      } else {
        const disputed = eventType === "charge.dispute.created";
        const chargeId = disputed ? objectId(eventObject.charge) : eventObject.id;
        const charge = await fetchStripe(`/charges/${encodeURIComponent(validateStripeId(chargeId, "charge"))}`);
        const paymentIntentId = validateStripeId(objectId(charge?.payment_intent), "paymentIntent");
        const intent = await fetchStripe(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
        const order = await loadOrder(String(intent?.metadata?.order_id ?? ""));
        payment = normalizeStripeReversal(charge, intent, order, config, providerUpdatedAt, disputed);
      }

      const result = await processPayment(payment, { eventId: event.id, eventType, environment: config.environment });
      telemetry.success({ status: 200, credited: Boolean(result?.credited), reversed: Boolean(result?.reversed) });
      return jsonResponse({ received: true, credited: Boolean(result?.credited), reversed: Boolean(result?.reversed) }, 200, requestId);
    } catch (error) {
      const status = error instanceof WebhookHttpError ? error.status : 500;
      const code = error instanceof WebhookHttpError ? error.code : "internal_error";
      telemetry.error({ code, status });
      return jsonResponse({ error: code }, status, requestId);
    }
  };
}
