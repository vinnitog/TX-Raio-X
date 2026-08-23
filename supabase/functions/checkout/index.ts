import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { CheckoutHttpError, createCheckoutHandler, createOrGetOrderRecord, STRIPE_API_VERSION, validateStripeSecretKey } from "../_shared/checkout.mjs";

const STRIPE_API_URL = "https://api.stripe.com/v1";
const ORDER_FIELDS = "id, provider, provider_environment, provider_checkout_session_id, provider_price_id, status, package_code, amount_cents, currency, updated_at";
function requiredEnv(name: string) { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`Missing required secret: ${name}`); return value; }
function getDefaultSecret(jsonName: string, legacyName: string) { const json = Deno.env.get(jsonName); if (json) { const keys = JSON.parse(json); if (typeof keys.default === "string" && keys.default) return keys.default; } return requiredEnv(legacyName); }
function getSupabaseAdmin() { return createClient(requiredEnv("SUPABASE_URL"), getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }

async function stripeRequest(path: string, init: RequestInit = {}) {
  const environment = Deno.env.get("STRIPE_ENVIRONMENT")?.trim() || "test";
  const secretKey = validateStripeSecretKey(requiredEnv("STRIPE_SECRET_KEY"), environment);
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_API_VERSION, ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  } catch { throw new CheckoutHttpError(502, "stripe_result_unknown", "Stripe request outcome is unknown."); }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const uncertain = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
    throw new CheckoutHttpError(502, uncertain ? "stripe_result_unknown" : "stripe_rejected", "Stripe checkout failed.");
  }
  return body;
}

Deno.serve(createCheckoutHandler({
  loadConfig: () => ({ environment: Deno.env.get("STRIPE_ENVIRONMENT")?.trim() || "test", priceId: requiredEnv("STRIPE_PRICE_ANALYSIS_PACK_10"), returnUrl: requiredEnv("CHECKOUT_RETURN_URL"), allowedOrigins: Deno.env.get("CHECKOUT_ALLOWED_ORIGINS") ?? "" }),
  authenticate: async (token: string) => { const { data, error } = await getSupabaseAdmin().auth.getUser(token); return error ? null : data.user; },
  enforceRateLimit: async (userId: string) => { const { data, error } = await getSupabaseAdmin().rpc("enforce_account_rate_limit", { p_user_id: userId, p_scope: "checkout", p_limit: 10, p_window_seconds: 600 }); if (error) throw error; return data === true; },
  createOrGetOrder: (args) => createOrGetOrderRecord(getSupabaseAdmin(), args),
  acquireRecoveryLease: async (order) => { const result = await getSupabaseAdmin().from("orders").update({ status: "creating_checkout" }).eq("id", order.id).eq("updated_at", order.updated_at).select(ORDER_FIELDS).maybeSingle(); if (result.error) throw result.error; return result.data; },
  markCreationStatus: async (order, status) => { const result = await getSupabaseAdmin().from("orders").update({ status }).eq("id", order.id).eq("status", "creating_checkout").select("id").maybeSingle(); if (result.error) throw result.error; return Boolean(result.data); },
  linkSession: async (order, sessionId) => { const result = await getSupabaseAdmin().from("orders").update({ provider_checkout_session_id: sessionId, status: "checkout_ready" }).eq("id", order.id).is("provider_checkout_session_id", null).select(ORDER_FIELDS).maybeSingle(); if (result.error) throw result.error; return result.data; },
  stripeRequest
}));
