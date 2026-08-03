import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { createProtectedAnalysisHandler } from "../_shared/protected-analysis.mjs";
import { analyzeTransaction } from "../_shared/transaction-analyzer.mjs";
import { findTransaction } from "../_shared/transaction-chain.mjs";

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

function admin() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function allowedOrigins() {
  const configured = Deno.env.get("CHECKOUT_ALLOWED_ORIGINS")?.trim();
  if (configured) return configured;
  return "http://localhost:4173,http://127.0.0.1:4173";
}

Deno.serve(createProtectedAnalysisHandler({
  loadAllowedOrigins: () => new Set(
    allowedOrigins().split(",").map((value) => value.trim()).filter(Boolean)
  ),
  authenticate: async (token: string) => {
    const { data, error } = await admin().auth.getUser(token);
    return error ? null : data.user;
  },
  enforceRateLimit: async (userId: string) => {
    const { data, error } = await admin().rpc("enforce_account_rate_limit", {
      p_user_id: userId,
      p_scope: "protected_analysis",
      p_limit: 10,
      p_window_seconds: 60
    });
    if (error) throw error;
    return data === true;
  },
  loadEntitlement: async (userId: string) => {
    const { data, error } = await admin().rpc("get_service_credit_entitlement", {
      p_user_id: userId
    }).single();
    if (error) throw error;
    return data;
  },
  loadReceipt: async (userId: string, analysisId: string) => {
    const { data, error } = await admin()
      .from("protected_analysis_receipts")
      .select("request_fingerprint")
      .eq("user_id", userId)
      .eq("analysis_id", analysisId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  findTransaction,
  analyzeTransaction,
  finalizeAnalysis: async (userId: string, analysisId: string, requestFingerprint: string) => {
    const { data, error } = await admin().rpc("finalize_protected_analysis", {
      p_user_id: userId,
      p_analysis_id: analysisId,
      p_request_fingerprint: requestFingerprint
    }).single();
    if (error) throw error;
    return data;
  }
}));
