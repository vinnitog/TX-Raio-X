export const CHECKOUT_OFFER = Object.freeze({
  code: "analysis_pack_10",
  credits: 10,
  amountCents: 490,
  currency: "BRL",
  title: "Tx Raio-X — pacote com 10 análises"
});

const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHECKOUT_RECOVERY_DELAY_MS = 5 * 60 * 1000;

export function validateCheckoutRequest(body, idempotencyKey) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey ?? "")) {
    return { ok: false, code: "invalid_idempotency_key" };
  }

  if (!body || body.packageCode !== CHECKOUT_OFFER.code) {
    return { ok: false, code: "invalid_package" };
  }

  return { ok: true, idempotencyKey };
}

export function validateCheckoutConfig(config) {
  if (config.environment !== "test") {
    throw new Error("Checkout production is disabled until the production review is complete.");
  }

  for (const [name, value] of [
    ["CHECKOUT_RETURN_URL", config.returnUrl],
    ["MERCADO_PAGO_WEBHOOK_URL", config.webhookUrl]
  ]) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  }
}

export function buildPreferencePayload(orderId, returnUrl, webhookUrl) {
  const successUrl = new URL(returnUrl);
  const pendingUrl = new URL(returnUrl);
  const failureUrl = new URL(returnUrl);
  successUrl.searchParams.set("checkout_status", "success");
  pendingUrl.searchParams.set("checkout_status", "pending");
  failureUrl.searchParams.set("checkout_status", "failure");

  return {
    items: [{
      id: CHECKOUT_OFFER.code,
      title: CHECKOUT_OFFER.title,
      category_id: "services",
      quantity: 1,
      currency_id: CHECKOUT_OFFER.currency,
      unit_price: CHECKOUT_OFFER.amountCents / 100
    }],
    external_reference: orderId,
    back_urls: {
      success: successUrl.toString(),
      pending: pendingUrl.toString(),
      failure: failureUrl.toString()
    },
    auto_return: "approved",
    notification_url: webhookUrl,
    statement_descriptor: "TXRAIOX"
  };
}

export function getCheckoutUrl(preference, environment) {
  const checkoutUrl = environment === "test"
    ? preference?.sandbox_init_point
    : preference?.init_point;

  if (typeof checkoutUrl !== "string" || !checkoutUrl.startsWith("https://")) {
    throw new Error("Mercado Pago did not return a valid checkout URL.");
  }

  return checkoutUrl;
}

export function validatePreferenceSnapshot(preference, order) {
  const matchingItems = Array.isArray(preference?.items)
    ? preference.items.filter((item) => item?.id === order.package_code)
    : [];
  const item = matchingItems[0];
  const matches = preference?.external_reference === order.id
    && preference.items.length === 1
    && matchingItems.length === 1
    && Number(item?.quantity) === 1
    && item?.currency_id === order.currency
    && Math.round(Number(item?.unit_price) * 100) === order.amount_cents;

  if (!matches) throw new Error("Mercado Pago preference does not match its order.");
  return preference;
}

export function findPreferenceByExternalReference(searchResult, orderId) {
  if (!Array.isArray(searchResult?.elements)) return null;
  return searchResult.elements.find((preference) => preference?.external_reference === orderId) ?? null;
}

export function isCheckoutRecoveryDue(updatedAt, now = Date.now()) {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && now - updatedAtMs >= CHECKOUT_RECOVERY_DELAY_MS;
}

export function getAllowedOrigins(returnUrl, configuredOrigins = "") {
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  origins.push(new URL(returnUrl).origin);
  return new Set(origins);
}

export function getCorsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export class CheckoutHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body, status, corsHeaders) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" }
  });
}

export function createCheckoutHandler({
  loadConfig,
  authenticate,
  createOrGetOrder,
  acquireRecoveryLease,
  markCreationStatus,
  linkPreference,
  mercadoPagoRequest,
  now = () => Date.now(),
  logger = console
}) {
  return async function handleCheckout(request) {
    let corsHeaders = {};

    try {
      const config = loadConfig();
      validateCheckoutConfig(config);

      const origin = request.headers.get("Origin") ?? "";
      const allowedOrigins = getAllowedOrigins(config.returnUrl, config.allowedOrigins ?? "");
      corsHeaders = getCorsHeaders(origin, allowedOrigins);

      if (origin && !allowedOrigins.has(origin)) {
        throw new CheckoutHttpError(403, "origin_not_allowed", "Origin is not allowed.");
      }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      if (request.method !== "POST") {
        throw new CheckoutHttpError(405, "method_not_allowed", "Use POST.");
      }

      const authorization = request.headers.get("Authorization") ?? "";
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) {
        throw new CheckoutHttpError(401, "authentication_required", "Authentication is required.");
      }

      const user = await authenticate(token);
      if (!user?.id) {
        throw new CheckoutHttpError(401, "invalid_session", "The authenticated session is invalid.");
      }

      const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        throw new CheckoutHttpError(415, "unsupported_media_type", "Use application/json.");
      }
      const declaredLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declaredLength) && declaredLength > 4096) {
        throw new CheckoutHttpError(413, "request_too_large", "Checkout request is too large.");
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 4096) {
        throw new CheckoutHttpError(413, "request_too_large", "Checkout request is too large.");
      }
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        // A valid JSON object is enforced by validateCheckoutRequest below.
      }
      const validation = validateCheckoutRequest(body, request.headers.get("Idempotency-Key"));
      if (!validation.ok) {
        throw new CheckoutHttpError(400, validation.code, "Invalid checkout request.");
      }

      const databaseIdempotencyKey = `checkout:${validation.idempotencyKey}`;
      const result = await createOrGetOrder({
        userId: user.id,
        idempotencyKey: databaseIdempotencyKey,
        offer: CHECKOUT_OFFER
      });
      let order = result?.order;
      const created = Boolean(result?.created);
      if (!order) {
        throw new CheckoutHttpError(409, "idempotency_conflict", "Checkout key is already in use.");
      }

      let preference;
      let reused = !created || Boolean(order.provider_preference_id);
      let ownsCreationLease = created;

      if (order.provider_preference_id) {
        preference = await mercadoPagoRequest(
          `/checkout/preferences/${encodeURIComponent(order.provider_preference_id)}`
        );
        validatePreferenceSnapshot(preference, order);
      } else if (!ownsCreationLease) {
        const searchResult = await mercadoPagoRequest(
          `/checkout/preferences/search?external_reference=${encodeURIComponent(order.id)}`
        );
        preference = findPreferenceByExternalReference(searchResult, order.id);

        if (preference) {
          validatePreferenceSnapshot(preference, order);
        } else {
          const canRecover = order.status === "preference_failed" || (
            ["creating_preference", "preference_unknown"].includes(order.status)
            && isCheckoutRecoveryDue(order.updated_at, now())
          );
          if (!canRecover) {
            throw new CheckoutHttpError(409, "checkout_in_progress", "Checkout reconciliation is still in progress.");
          }

          const leasedOrder = await acquireRecoveryLease(order);
          if (!leasedOrder) {
            throw new CheckoutHttpError(409, "checkout_in_progress", "Another request acquired checkout recovery.");
          }
          order = leasedOrder;
          ownsCreationLease = true;
          reused = true;
        }
      }

      if (!preference && ownsCreationLease) {
        try {
          preference = await mercadoPagoRequest("/checkout/preferences", {
            method: "POST",
            headers: { "X-Idempotency-Key": order.id },
            body: JSON.stringify(buildPreferencePayload(order.id, config.returnUrl, config.webhookUrl))
          });
        } catch (error) {
          const status = error instanceof CheckoutHttpError && error.code === "mercado_pago_rejected"
            ? "preference_failed"
            : "preference_unknown";
          const marked = await markCreationStatus(order, status);
          if (!marked) {
            throw new CheckoutHttpError(409, "checkout_reconciliation_required", "Checkout outcome could not be persisted.");
          }
          throw error;
        }

        if (typeof preference?.id !== "string" || !preference.id) {
          const marked = await markCreationStatus(order, "preference_unknown");
          if (!marked) {
            throw new CheckoutHttpError(409, "checkout_reconciliation_required", "Checkout outcome could not be persisted.");
          }
          throw new CheckoutHttpError(502, "invalid_provider_response", "Mercado Pago did not return a preference ID.");
        }
        validatePreferenceSnapshot(preference, order);
      }

      if (!order.provider_preference_id) {
        const linkedOrder = await linkPreference(order, preference.id);
        if (!linkedOrder) {
          throw new CheckoutHttpError(409, "checkout_reconciliation_required", "Preference could not be linked to its order.");
        }
        order = linkedOrder;
      }

      return jsonResponse({
        orderId: order.id,
        checkoutUrl: getCheckoutUrl(preference, config.environment),
        reused,
        environment: config.environment
      }, reused ? 200 : 201, corsHeaders);
    } catch (error) {
      const status = error instanceof CheckoutHttpError ? error.status : 500;
      const code = error instanceof CheckoutHttpError ? error.code : "internal_error";
      logger.error("checkout_error", {
        code,
        message: String(error?.message ?? error).slice(0, 200)
      });
      return jsonResponse({ error: code }, status, corsHeaders);
    }
  };
}
