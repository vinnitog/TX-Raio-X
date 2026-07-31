import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  CheckoutHttpError,
  createCheckoutHandler,
  createOrGetOrderRecord
} from "../_shared/checkout.mjs";

const MERCADO_PAGO_API_URL = "https://api.mercadopago.com";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function getDefaultSecret(jsonName: string, legacyName: string) {
  const json = Deno.env.get(jsonName);
  if (json) {
    const keys = JSON.parse(json);
    if (typeof keys.default === "string" && keys.default) return keys.default;
  }
  return requiredEnv(legacyName);
}

async function mercadoPagoRequest(path: string, accessToken: string, init?: RequestInit) {
  let response;
  try {
    response = await fetch(`${MERCADO_PAGO_API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init?.headers
      }
    });
  } catch {
    throw new CheckoutHttpError(502, "mercado_pago_result_unknown", "Mercado Pago request outcome is unknown.");
  }
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const providerCode = body?.message ?? body?.error ?? "provider_error";
    const hasUncertainOutcome = response.status >= 500 || [408, 409, 423].includes(response.status);
    const code = hasUncertainOutcome
      ? "mercado_pago_result_unknown"
      : "mercado_pago_rejected";
    throw new CheckoutHttpError(502, code, String(providerCode).slice(0, 160));
  }
  return body;
}

const ORDER_FIELDS = "id, provider_preference_id, status, package_code, amount_cents, currency, updated_at";

Deno.serve(createCheckoutHandler({
  loadConfig: () => ({
      environment: Deno.env.get("MERCADO_PAGO_ENVIRONMENT")?.trim() || "test",
      returnUrl: requiredEnv("CHECKOUT_RETURN_URL"),
      webhookUrl: requiredEnv("MERCADO_PAGO_WEBHOOK_URL"),
      allowedOrigins: Deno.env.get("CHECKOUT_ALLOWED_ORIGINS") ?? ""
  }),
  authenticate: async (token: string) => {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const secretKey = getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    return authError ? null : authData.user;
  },
  createOrGetOrder: (args) => createOrGetOrderRecord(getSupabaseAdmin(), args, ORDER_FIELDS),
  acquireRecoveryLease: async (order) => {
    const lease = await getSupabaseAdmin()
          .from("orders")
          .update({ status: "creating_preference" })
          .eq("id", order.id)
          .eq("updated_at", order.updated_at)
          .select(ORDER_FIELDS)
          .maybeSingle();
    if (lease.error) throw lease.error;
    return lease.data;
  },
  markCreationStatus: async (order, status) => {
    const result = await getSupabaseAdmin().from("orders").update({ status })
      .eq("id", order.id).eq("status", "creating_preference").select("id").maybeSingle();
    if (result.error) throw result.error;
    return Boolean(result.data);
  },
  linkPreference: async (order, preferenceId) => {
    const linkedOrder = await getSupabaseAdmin()
        .from("orders")
        .update({ provider_preference_id: preferenceId, status: "checkout_ready" })
        .eq("id", order.id)
        .is("provider_preference_id", null)
        .select(ORDER_FIELDS)
        .maybeSingle();
    if (linkedOrder.error) throw linkedOrder.error;
    return linkedOrder.data;
  },
  mercadoPagoRequest: (path, init) => mercadoPagoRequest(
    path,
    requiredEnv("MERCADO_PAGO_ACCESS_TOKEN"),
    init
  )
}));

function getSupabaseAdmin() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
