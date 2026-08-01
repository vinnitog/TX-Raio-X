import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  createMercadoPagoWebhookHandler,
  parseBooleanConfig,
  WebhookHttpError
} from "../_shared/mercado-pago-webhook.mjs";

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function requiredBooleanEnv(name: string) {
  return parseBooleanConfig(requiredEnv(name), name);
}

function getDefaultSecret(jsonName: string, legacyName: string) {
  const json = Deno.env.get(jsonName);
  if (json) {
    const keys = JSON.parse(json);
    if (typeof keys.default === "string" && keys.default) return keys.default;
  }
  return requiredEnv(legacyName);
}

function getSupabaseAdmin() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function mercadoPagoGet(path: string) {
  let response: Response;
  try {
    response = await fetch(`${MERCADO_PAGO_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${requiredEnv("MERCADO_PAGO_ACCESS_TOKEN")}` },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    throw new WebhookHttpError(502, "mercado_pago_unavailable", "Could not read payment.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WebhookHttpError(502, "mercado_pago_unavailable", "Could not read payment.");
  }
  return body;
}

Deno.serve(createMercadoPagoWebhookHandler({
  loadConfig: () => ({
    environment: Deno.env.get("MERCADO_PAGO_ENVIRONMENT")?.trim() || "test",
    webhookSecret: requiredEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
    collectorId: requiredEnv("MERCADO_PAGO_COLLECTOR_ID"),
    paymentLiveMode: requiredBooleanEnv("MERCADO_PAGO_PAYMENT_LIVE_MODE")
  }),
  fetchPayment: (paymentId: string) => mercadoPagoGet(`/v1/payments/${encodeURIComponent(paymentId)}`),
  fetchMerchantOrder: (orderId: string) => mercadoPagoGet(`/merchant_orders/${encodeURIComponent(orderId)}`),
  loadOrder: async (orderId: string) => {
    const result = await getSupabaseAdmin()
      .from("orders")
      .select("id, provider, provider_preference_id, amount_cents, currency")
      .eq("id", orderId)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  },
  processPayment: async (payment: Record<string, unknown>) => {
    const result = await getSupabaseAdmin().rpc("process_mercado_pago_payment", {
      p_order_id: payment.orderId,
      p_provider_payment_id: payment.providerPaymentId,
      p_status: payment.status,
      p_status_detail: payment.statusDetail,
      p_amount_cents: payment.amountCents,
      p_refunded_cents: payment.refundedCents,
      p_currency: payment.currency,
      p_approved_at: payment.approvedAt,
      p_provider_updated_at: payment.providerUpdatedAt
    });
    if (result.error) throw result.error;
    return result.data?.[0] ?? null;
  }
}));
