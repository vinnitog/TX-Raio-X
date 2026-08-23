import { createRequestTelemetry, getRequestId, withRequestId } from "./observability.mjs";

export const CHECKOUT_OFFER = Object.freeze({ code: "analysis_pack_10", credits: 10, amountCents: 490, currency: "BRL", title: "Tx Raio-X — pacote com 10 análises" });
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_SESSION_ID_PATTERN = /^cs_test_[A-Za-z0-9]{8,255}$/;
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,255}$/;
export const STRIPE_API_VERSION = "2026-02-25.clover";
export const CHECKOUT_RECOVERY_DELAY_MS = 5 * 60 * 1000;

export class CheckoutHttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function validateCheckoutRequest(body, idempotencyKey) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey ?? "")) return { ok: false, code: "invalid_idempotency_key" };
  if (!body || Array.isArray(body) || body.packageCode !== CHECKOUT_OFFER.code) return { ok: false, code: "invalid_package" };
  return { ok: true, idempotencyKey };
}

export function validateStripeEnvironment(environment) {
  if (environment !== "test") throw new Error("Stripe production is disabled until the production review is complete.");
  return environment;
}

export function validateStripeSecretKey(secretKey, environment = "test") {
  validateStripeEnvironment(environment);
  const value = String(secretKey ?? "").trim();
  if (!value.startsWith("sk_test_") || value.length < 20) throw new Error("STRIPE_SECRET_KEY must use a valid sk_test_ credential.");
  return value;
}

export function validateCheckoutConfig(config) {
  validateStripeEnvironment(config.environment);
  const returnUrl = new URL(config.returnUrl);
  if (returnUrl.protocol !== "https:") throw new Error("CHECKOUT_RETURN_URL must use HTTPS.");
  if (!STRIPE_PRICE_ID_PATTERN.test(config.priceId ?? "")) throw new Error("STRIPE_PRICE_ANALYSIS_PACK_10 must be a valid Stripe Price ID.");
}

export function buildStripeCheckoutPayload(orderId, priceId, returnUrl) {
  if (!ORDER_ID_PATTERN.test(orderId) || !STRIPE_PRICE_ID_PATTERN.test(priceId ?? "")) throw new CheckoutHttpError(422, "invalid_order_snapshot", "Invalid checkout snapshot.");
  const successUrl = new URL(returnUrl);
  successUrl.searchParams.set("source", "checkout");
  successUrl.searchParams.set("checkout_status", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL(returnUrl);
  cancelUrl.searchParams.set("source", "checkout");
  cancelUrl.searchParams.set("checkout_status", "cancelled");
  return new URLSearchParams({
    mode: "payment", locale: "pt-BR", success_url: successUrl.toString(), cancel_url: cancelUrl.toString(),
    client_reference_id: orderId,
    "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
    "metadata[order_id]": orderId, "metadata[package_code]": CHECKOUT_OFFER.code,
    "payment_intent_data[metadata][order_id]": orderId,
    "payment_intent_data[metadata][package_code]": CHECKOUT_OFFER.code
  });
}

export function getStripeCheckoutUrl(session) {
  let url;
  try { url = new URL(session?.url); } catch { throw new CheckoutHttpError(502, "invalid_provider_response", "Stripe returned an invalid checkout URL."); }
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new CheckoutHttpError(502, "invalid_provider_response", "Stripe returned an invalid checkout URL.");
  return url.toString();
}

export function validateStripeCheckoutSession(session, order) {
  const matches = STRIPE_SESSION_ID_PATTERN.test(String(session?.id ?? ""))
    && session?.mode === "payment" && session?.status === "open" && session?.payment_status === "unpaid"
    && session?.client_reference_id === order.id && session?.metadata?.order_id === order.id
    && session?.metadata?.package_code === order.package_code
    && Number(session?.amount_total) === order.amount_cents
    && String(session?.currency ?? "").toUpperCase() === order.currency;
  if (!matches) throw new CheckoutHttpError(502, "invalid_provider_snapshot", "Stripe session does not match its order.");
  getStripeCheckoutUrl(session);
  return session;
}

export function isCheckoutRecoveryDue(updatedAt, now = Date.now()) {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && now - updatedAtMs >= CHECKOUT_RECOVERY_DELAY_MS;
}

export function getAllowedOrigins(returnUrl, configuredOrigins = "") {
  const origins = configuredOrigins.split(",").map((origin) => origin.trim()).filter(Boolean);
  origins.push(new URL(returnUrl).origin);
  return new Set(origins);
}

export function getCorsHeaders(origin, allowedOrigins) {
  const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export async function createOrGetOrderRecord(supabaseAdmin, { userId, idempotencyKey, offer, environment, priceId }) {
  const { data, error } = await supabaseAdmin.rpc("create_or_get_stripe_checkout_order", {
    p_user_id: userId, p_provider_environment: environment, p_idempotency_key: idempotencyKey,
    p_package_code: offer.code, p_package_credits: offer.credits,
    p_amount_cents: offer.amountCents, p_currency: offer.currency,
    p_provider_price_id: priceId
  });
  if (error?.message === "account_erasure_in_progress") throw new CheckoutHttpError(409, "account_erasure_in_progress", "Account deletion is in progress.");
  if (error) throw error;
  return { order: data?.order ?? null, created: data?.created === true };
}

function jsonResponse(body, status, corsHeaders, requestId) {
  return Response.json(body, { status, headers: withRequestId({ ...corsHeaders, "Cache-Control": "no-store" }, requestId) });
}

export function createCheckoutHandler({ loadConfig, authenticate, enforceRateLimit = async () => true, createOrGetOrder, acquireRecoveryLease, markCreationStatus, linkSession, stripeRequest, now = () => Date.now(), logger = console }) {
  return async function handleCheckout(request) {
    let corsHeaders = {};
    const requestId = getRequestId(request);
    const telemetry = createRequestTelemetry(logger, "checkout_request", requestId, now);
    try {
      const config = loadConfig();
      validateCheckoutConfig(config);
      const origin = request.headers.get("Origin") ?? "";
      const allowedOrigins = getAllowedOrigins(config.returnUrl, config.allowedOrigins ?? "");
      corsHeaders = getCorsHeaders(origin, allowedOrigins);
      if (origin && !allowedOrigins.has(origin)) throw new CheckoutHttpError(403, "origin_not_allowed", "Origin is not allowed.");
      if (request.method === "OPTIONS") { telemetry.ignored({ code: "preflight", status: 204 }); return new Response(null, { status: 204, headers: withRequestId(corsHeaders, requestId) }); }
      if (request.method !== "POST") throw new CheckoutHttpError(405, "method_not_allowed", "Use POST.");
      const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) throw new CheckoutHttpError(401, "authentication_required", "Authentication is required.");
      const user = await authenticate(token);
      if (!user?.id) throw new CheckoutHttpError(401, "invalid_session", "The authenticated session is invalid.");
      if (!await enforceRateLimit(user.id)) throw new CheckoutHttpError(429, "rate_limited", "Too many checkout requests.");
      const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") throw new CheckoutHttpError(415, "unsupported_media_type", "Use application/json.");
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 4096) throw new CheckoutHttpError(413, "request_too_large", "Checkout request is too large.");
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 4096) throw new CheckoutHttpError(413, "request_too_large", "Checkout request is too large.");
      let body = null;
      try { body = JSON.parse(rawBody); } catch { /* validation below */ }
      const validation = validateCheckoutRequest(body, request.headers.get("Idempotency-Key"));
      if (!validation.ok) throw new CheckoutHttpError(400, validation.code, "Invalid checkout request.");

      const result = await createOrGetOrder({ userId: user.id, idempotencyKey: `stripe:${config.environment}:checkout:${validation.idempotencyKey}`, offer: CHECKOUT_OFFER, environment: config.environment, priceId: config.priceId });
      let order = result?.order;
      const created = Boolean(result?.created);
      if (!order) throw new CheckoutHttpError(409, "idempotency_conflict", "Checkout key is already in use.");
      if (order.provider !== "stripe" || order.provider_environment !== config.environment) throw new CheckoutHttpError(409, "idempotency_conflict", "Checkout key belongs to another provider environment.");

      let session;
      let ownsCreationLease = created;
      const reused = !created || Boolean(order.provider_checkout_session_id);
      if (order.provider_checkout_session_id) {
        session = await stripeRequest(`/checkout/sessions/${encodeURIComponent(order.provider_checkout_session_id)}`);
        validateStripeCheckoutSession(session, order);
      } else if (!created) {
        const canRecover = order.status === "payment_rejected" || (["creating_checkout", "checkout_unknown"].includes(order.status) && isCheckoutRecoveryDue(order.updated_at, now()));
        if (!canRecover) throw new CheckoutHttpError(409, "checkout_in_progress", "Checkout reconciliation is still in progress.");
        const leasedOrder = await acquireRecoveryLease(order);
        if (!leasedOrder) throw new CheckoutHttpError(409, "checkout_in_progress", "Another request acquired checkout recovery.");
        order = leasedOrder;
        ownsCreationLease = true;
      }

      if (!session && ownsCreationLease) {
        try {
          session = await stripeRequest("/checkout/sessions", { method: "POST", headers: { "Idempotency-Key": order.id }, body: buildStripeCheckoutPayload(order.id, order.provider_price_id, config.returnUrl) });
          validateStripeCheckoutSession(session, order);
        } catch (error) {
          const status = error instanceof CheckoutHttpError && error.code === "stripe_rejected" ? "payment_rejected" : "checkout_unknown";
          if (!await markCreationStatus(order, status)) throw new CheckoutHttpError(409, "checkout_reconciliation_required", "Checkout outcome could not be persisted.");
          throw error;
        }
      }
      if (!order.provider_checkout_session_id) {
        order = await linkSession(order, session.id);
        if (!order) throw new CheckoutHttpError(409, "checkout_reconciliation_required", "Stripe session could not be linked to its order.");
      }
      const status = reused ? 200 : 201;
      telemetry.success({ status, reused });
      return jsonResponse({ orderId: order.id, checkoutUrl: getStripeCheckoutUrl(session), reused, environment: config.environment }, status, corsHeaders, requestId);
    } catch (error) {
      const status = error instanceof CheckoutHttpError ? error.status : 500;
      const code = error instanceof CheckoutHttpError ? error.code : "internal_error";
      telemetry.error({ code, status });
      return jsonResponse({ error: code }, status, corsHeaders, requestId);
    }
  };
}
