import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./auth-config.mjs";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  }
});
