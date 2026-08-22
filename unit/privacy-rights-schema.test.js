const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(
  root, "supabase/migrations/20260822000100_privacy_rights_and_retention.sql"
), "utf8");

test("privacy rights tables and RPCs are service-role only", () => {
  assert.match(migration, /create table public\.privacy_requests/);
  assert.match(migration, /revoke all on table public\.privacy_requests from public, anon, authenticated/i);
  for (const fn of ["get_account_privacy_export", "get_account_erasure_eligibility", "begin_account_erasure", "complete_account_erasure", "cleanup_expired_operational_data"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?service_role`, "i"));
  }
});

test("automatic erasure blocks paid balance and non-terminal checkout states", () => {
  const eligibility = migration.match(/create or replace function public\.get_account_erasure_eligibility[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(eligibility, /entry_type not in \('free_grant', 'free_consumption'\)/i);
  assert.doesNotMatch(eligibility, /provider_preference_id is not null/i);
  assert.match(eligibility, /status not in\s*\(\s*'payment_approved',\s*'payment_rejected',\s*'payment_cancelled',\s*'payment_refunded',\s*'payment_charged_back',\s*'preference_failed'\s*\)/i);
});

test("checkout and account erasure serialize on one account lock", () => {
  const begin = migration.match(/create or replace function public\.begin_account_erasure[\s\S]*?\$\$;/i)?.[0] ?? "";
  const guard = migration.match(/create or replace function public\.guard_checkout_during_erasure[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(begin, /pg_advisory_xact_lock\(hashtextextended\('privacy-erasure:' \|\| p_user_id::text, 0\)\)/i);
  assert.match(guard, /pg_advisory_xact_lock\(hashtextextended\('privacy-erasure:' \|\| new\.user_id::text, 0\)\)/i);
  assert.match(guard, /status = 'processing'/i);
  assert.match(guard, /status = 'failed'[\s\S]*interval '15 minutes'/i);
  assert.match(migration, /create trigger orders_guard_checkout_during_erasure[\s\S]*before insert on public\.orders/i);
  const beginLock = begin.match(/hashtextextended\(([^\n]+), 0\)/i)?.[1];
  const guardLock = guard.match(/hashtextextended\(([^\n]+), 0\)/i)?.[1];
  assert.equal(beginLock?.replace(/p_user_id/g, "user_id"), guardLock?.replace(/new\.user_id/g, "user_id"));
});

test("export excludes secrets and deletion anonymizes financial ownership", () => {
  const exportFunction = migration.match(/create or replace function public\.get_account_privacy_export[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.doesNotMatch(exportFunction, /idempotency_key|status_detail/i);
  for (const accountData of ["protected_analysis_receipts", "operational_rate_limits", "privacy_requests"]) {
    assert.match(exportFunction, new RegExp(`from public\\.${accountData}\\b`, "i"));
  }
  const billing = fs.readFileSync(path.join(root, "supabase/migrations/20260731000100_create_billing_tables.sql"), "utf8");
  for (const table of ["orders", "payments", "credit_ledger"]) {
    assert.match(billing, new RegExp(`create table public\\.${table}[\\s\\S]*?user_id uuid references auth\\.users\\(id\\) on delete set null`, "i"));
  }
});

test("completed erasure audit cannot regress to failed during concurrent requests", () => {
  const completion = migration.match(/create or replace function public\.complete_account_erasure[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(completion, /when p_status = 'completed' or status = 'completed' then 'completed'/i);
  assert.match(completion, /p_status not in \('completed', 'failed'\)/i);
});

test("retention cleanup is bounded and never removes idempotency receipts", () => {
  const cleanup = migration.match(/create or replace function public\.cleanup_expired_operational_data[\s\S]*?\$\$;/i)?.[0] ?? "";
  const limiter = migration.match(/create or replace function public\.enforce_account_rate_limit[\s\S]*?\$\$;/i)?.[0] ?? "";
  assert.match(cleanup, /operational_rate_limits[\s\S]*interval '2 days'/i);
  assert.match(limiter, /delete from public\.operational_rate_limits[\s\S]*interval '2 days'/i);
  assert.match(cleanup, /privacy_requests[\s\S]*status = 'failed'[\s\S]*interval '90 days'/i);
  assert.match(cleanup, /status = 'processing'[\s\S]*user_id is null[\s\S]*interval '15 minutes'/i);
  assert.match(cleanup, /status = 'processing'[\s\S]*user_id is not null[\s\S]*interval '15 minutes'/i);
  assert.doesNotMatch(cleanup, /protected_analysis_receipts/i);
  assert.match(migration, /tx-raio-x-operational-retention/);
  assert.match(migration, /p_scope not in \('checkout', 'consume_analysis', 'protected_analysis', 'privacy_account'\)/);
});
