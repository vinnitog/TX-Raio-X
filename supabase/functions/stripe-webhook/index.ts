import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { STRIPE_API_VERSION, validateStripeSecretKey } from "../_shared/checkout.mjs";
import { createStripeWebhookHandler, WebhookHttpError } from "../_shared/stripe-webhook.mjs";

const STRIPE_API_URL = "https://api.stripe.com/v1";
function requiredEnv(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing required secret: ${name}`); return value; }
function getDefaultSecret(jsonName: string, legacyName: string) { const json = Deno.env.get(jsonName); if (json) { const keys = JSON.parse(json); if (typeof keys.default === "string" && keys.default) return keys.default; } return requiredEnv(legacyName); }
function getAdmin() { return createClient(requiredEnv("SUPABASE_URL"), getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }

async function stripeGet(path: string) {
  const environment = Deno.env.get("STRIPE_ENVIRONMENT")?.trim() || "test";
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_URL}${path}`, { headers: { Authorization: `Bearer ${validateStripeSecretKey(requiredEnv("STRIPE_SECRET_KEY"), environment)}`, "Stripe-Version": STRIPE_API_VERSION }, signal: AbortSignal.timeout(10_000) });
  } catch { throw new WebhookHttpError(502, "stripe_unavailable", "Stripe resource verification failed."); }
  if (!response.ok) throw new WebhookHttpError(502, "stripe_unavailable", "Stripe resource verification failed.");
  return response.json();
}

Deno.serve(createStripeWebhookHandler({
  loadConfig: () => ({ environment: Deno.env.get("STRIPE_ENVIRONMENT")?.trim() || "test", webhookSecret: requiredEnv("STRIPE_WEBHOOK_SECRET") }),
  fetchStripe: stripeGet,
  loadOrder: async (orderId: string) => { const result = await getAdmin().from("orders").select("id, provider, provider_environment, provider_checkout_session_id, provider_price_id, package_code, amount_cents, currency").eq("id", orderId).maybeSingle(); if (result.error) throw result.error; return result.data; },
  processPayment: async (payment, event) => {
    const result = await getAdmin().rpc("process_stripe_payment", {
      p_event_id: event.eventId, p_provider_environment: event.environment, p_event_type: event.eventType,
      p_order_id: payment.orderId, p_provider_payment_id: payment.providerPaymentId,
      p_status: payment.status, p_status_detail: payment.statusDetail,
      p_amount_cents: payment.amountCents, p_refunded_cents: payment.refundedCents,
      p_currency: payment.currency, p_approved_at: payment.approvedAt,
      p_provider_updated_at: payment.providerUpdatedAt
    });
    if (result.error) throw result.error;
    return result.data?.[0] ?? null;
  },
  processExpiration: async (expired, event) => {
    const result = await getAdmin().rpc("process_stripe_checkout_expiration", {
      p_event_id: event.eventId,
      p_provider_environment: event.environment,
      p_order_id: expired.orderId,
      p_provider_checkout_session_id: expired.sessionId,
      p_provider_updated_at: event.providerUpdatedAt
    });
    if (result.error) throw result.error;
  }
}));
