const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("rate limits are account-scoped, transactional and inaccessible to browser roles", () => {
  const migration = read("supabase/migrations/20260802000200_operational_protection.sql");
  assert.match(migration, /primary key \(scope, user_id, window_started_at\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /on conflict \(scope, user_id, window_started_at\)[\s\S]*request_count \+ 1/i);
  assert.match(migration, /revoke all on function public\.enforce_account_rate_limit[\s\S]*public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.enforce_account_rate_limit[\s\S]*service_role/i);
});

test("financial Edge Functions enforce explicit limits after authentication", () => {
  const checkout = read("supabase/functions/checkout/index.ts");
  const consumption = read("supabase/functions/consume-analysis/index.ts");
  assert.match(checkout, /p_scope:\s*"checkout"[\s\S]*p_limit:\s*10[\s\S]*p_window_seconds:\s*600/);
  assert.match(consumption, /p_scope:\s*"consume_analysis"[\s\S]*p_limit:\s*30[\s\S]*p_window_seconds:\s*60/);
  assert.match(checkout, /enforceRateLimit:/);
  assert.match(consumption, /enforceRateLimit:/);
});

test("structured telemetry correlates responses without logging messages or user data", () => {
  const telemetry = read("supabase/functions/_shared/observability.mjs");
  const handlers = [
    read("supabase/functions/_shared/checkout.mjs"),
    read("supabase/functions/_shared/consume-analysis.mjs"),
    read("supabase/functions/_shared/mercado-pago-webhook.mjs")
  ].join("\n");
  assert.match(telemetry, /X-Request-Id/);
  assert.match(telemetry, /durationMs/);
  assert.match(handlers, /telemetry\.success/);
  assert.match(handlers, /telemetry\.error\(\{ code, status \}\)/);
  assert.doesNotMatch(handlers, /message:\s*String\(error/);
  assert.doesNotMatch(handlers, /telemetry\.(?:success|error|ignored)\([^)]*userId/);
});

test("reconciliation view detects stale checkout and approved payments without grants", () => {
  const migration = read("supabase/migrations/20260802000200_operational_protection.sql");
  assert.match(migration, /'stuck_checkout'::text/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /'approved_without_purchase'::text/);
  assert.match(migration, /credit_ledger\.entry_type = 'purchase'/);
  assert.match(migration, /revoke all on table public\.billing_reconciliation_anomalies from public, anon, authenticated/i);
});
