const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../supabase/migrations/20260802000100_account_free_allowance.sql"
), "utf8");

test("every account receives one idempotent server-side free grant", () => {
  assert.match(migration, /entry_type = 'free_grant' and user_id is not null/);
  assert.match(migration, /'free_grant:' \|\| new\.id::text/);
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /from auth\.users users[\s\S]*on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /entry_type = 'free_grant' and credit_delta = 2/);
});

test("free and paid balances remain distinct and free allowance is consumed first", () => {
  assert.match(migration, /entry_type not in \('free_grant', 'free_consumption'\)/);
  assert.match(migration, /entry_type in \('free_grant', 'free_consumption'\)/);
  assert.ok(
    migration.indexOf("if current_free_remaining > 0")
      < migration.indexOf("if current_paid_balance < 1")
  );
  assert.match(migration, /'free_consumption', -1, consumption_key/);
  assert.match(migration, /'consumption', -1, consumption_key/);
});

test("browser roles cannot create grants or consume allowance directly", () => {
  assert.match(migration, /revoke all on function public\.grant_account_free_allowance\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.consume_analysis_credit\(uuid, uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.consume_analysis_credit\(uuid, uuid\)[\s\S]*to service_role/);
});
