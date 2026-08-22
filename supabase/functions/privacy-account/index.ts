import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { createPrivacyAccountHandler } from "../_shared/privacy-account.mjs";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function getSecretKey() {
  const json = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (json) {
    const keys = JSON.parse(json);
    if (typeof keys.default === "string" && keys.default) return keys.default;
  }
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function admin() {
  return createClient(requiredEnv("SUPABASE_URL"), getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function jwtIssuedAt(token: string) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(payload));
    return Number.isInteger(parsed.iat) ? parsed.iat : null;
  } catch { return null; }
}

function allowedOrigins() {
  const configured = (Deno.env.get("CHECKOUT_ALLOWED_ORIGINS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  configured.push(new URL(requiredEnv("CHECKOUT_RETURN_URL")).origin);
  return new Set(configured);
}

Deno.serve(createPrivacyAccountHandler({
  loadAllowedOrigins: allowedOrigins,
  authenticate: async (token: string) => {
    const { data, error } = await admin().auth.getUser(token);
    return error ? null : { user: data.user, issuedAt: jwtIssuedAt(token) };
  },
  enforceRateLimit: async (userId: string) => {
    const { data, error } = await admin().rpc("enforce_account_rate_limit", {
      p_user_id: userId,
      p_scope: "privacy_account",
      p_limit: 10,
      p_window_seconds: 600
    });
    if (error) throw error;
    return data === true;
  },
  exportAccount: async (userId: string) => {
    const { data, error } = await admin().rpc("get_account_privacy_export", { p_user_id: userId });
    if (error) throw error;
    return data;
  },
  checkErasureEligibility: async (userId: string) => {
    const { data, error } = await admin().rpc("get_account_erasure_eligibility", { p_user_id: userId });
    if (error) throw error;
    return data;
  },
  beginErasure: async (userId: string) => {
    const { data, error } = await admin().rpc("begin_account_erasure", { p_user_id: userId });
    if (error) throw error;
    return data;
  },
  deleteAccount: async (userId: string) => {
    const { error } = await admin().auth.admin.deleteUser(userId, false);
    if (error) throw error;
  },
  completeErasure: async (requestId: string, status: string) => {
    const { data, error } = await admin().rpc("complete_account_erasure", {
      p_request_id: requestId,
      p_status: status
    });
    if (error || data !== true) throw error ?? new Error("Erasure request not found");
  }
}));
