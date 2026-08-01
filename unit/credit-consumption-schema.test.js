const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260801000100_add_account_credit_consumption.sql"),
  "utf8"
);

test("authenticated balance is derived from the caller own append-only ledger", () => {
  assert.match(migration, /function public\.get_credit_entitlement\(\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /entry\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /greatest\(coalesce\(sum\(entry\.credit_delta\), 0\), 0\)/);
  assert.match(migration, /grant execute on function public\.get_credit_entitlement\(\) to authenticated/);
  assert.match(migration, /revoke all on function public\.get_credit_entitlement\(\) from public, anon/);
});

test("paid wallet entitlement excludes fully reversed purchases", () => {
  assert.match(migration, /purchase\.entry_type = 'purchase'/);
  assert.match(migration, /reversal\.payment_id = purchase\.payment_id/);
  assert.match(migration, /reversal\.entry_type in \('refund', 'chargeback'\)/);
});

test("consumption is serialized per account and idempotent per analysis UUID", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 0\)\)/);
  assert.match(migration, /'analysis:' \|\| p_user_id::text \|\| ':' \|\| p_analysis_id::text/);
  assert.match(migration, /entry\.entry_type = 'consumption'/);
  assert.match(migration, /entry\.credit_delta = -1/);
  assert.match(migration, /if current_balance < 1/);
});

test("only service role can execute the financial consumption RPC", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.consume_analysis_credit\(uuid, uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.consume_analysis_credit\(uuid, uuid\)[\s\S]*to service_role/);
});
