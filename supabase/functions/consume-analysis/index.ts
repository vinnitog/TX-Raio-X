import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { createConsumeAnalysisHandler } from "../_shared/consume-analysis.mjs";

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

function getSupabaseAdmin() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    getDefaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

Deno.serve(createConsumeAnalysisHandler({
  loadAllowedOrigins: () => new Set(
    requiredEnv("CHECKOUT_ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  ),
  authenticate: async (token: string) => {
    const { data, error } = await getSupabaseAdmin().auth.getUser(token);
    return error ? null : data.user;
  },
  consumeCredit: async (userId: string, analysisId: string) => {
    const { data, error } = await getSupabaseAdmin()
      .rpc("consume_analysis_credit", {
        p_user_id: userId,
        p_analysis_id: analysisId
      })
      .single();
    if (error) throw error;
    return data;
  }
}));
