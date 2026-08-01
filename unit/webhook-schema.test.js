const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const migrationPath = path.join(root, "supabase/migrations/20260731000200_process_mercado_pago_webhook.sql");
const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase().replace(/\s+/g, " ");

test("webhook RPC is transactional, security definer and service-role only", () => {
  assert.match(sql, /create or replace function public\.process_mercado_pago_payment/);
  assert.match(sql, /language plpgsql security definer set search_path = ''/);
  assert.match(sql, /select \* into locked_order from public\.orders where id = p_order_id for update/);
  assert.match(sql, /revoke all on function public\.process_mercado_pago_payment[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.process_mercado_pago_payment[\s\S]*to service_role/);
});

test("approved payments credit once using independent database constraints", () => {
  assert.match(sql, /if p_status = 'approved' and locked_order\.user_id is not null then/);
  assert.match(sql, /'purchase', locked_order\.package_credits/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /'mercado_pago:payment:' \|\| p_provider_payment_id \|\| ':purchase'/);
});

test("full reversals require an existing purchase and stay idempotent", () => {
  assert.match(sql, /p_status = 'refunded' and p_refunded_cents = p_amount_cents/);
  assert.match(sql, /p_status = 'charged_back'/);
  assert.match(sql, /if exists \( select 1 from public\.credit_ledger purchase_entry where purchase_entry\.payment_id = persisted_payment\.id and purchase_entry\.entry_type = 'purchase' \)/);
  assert.match(sql, /':reversal'/);
  assert.doesNotMatch(sql, /p_status = 'refunded' and p_refunded_cents < p_amount_cents/);
});

test("payment, order state and ledger are changed by one database function", () => {
  assert.match(sql, /insert into public\.payments/);
  assert.match(sql, /update public\.orders/);
  assert.match(sql, /insert into public\.credit_ledger/);
  assert.equal(sql.includes("commit"), false, "the function must use the caller transaction boundary");
});

test("provider update time and terminal dominance prevent stale approval races", () => {
  assert.match(sql, /add column provider_updated_at timestamptz/);
  assert.match(sql, /persisted_payment\.provider_updated_at > p_provider_updated_at/);
  assert.match(sql, /persisted_payment\.status in \('refunded', 'charged_back'\)/);
  assert.match(sql, /p_status not in \('refunded', 'charged_back'\)/);
  assert.match(sql, /return query select persisted_payment\.id, false, false/);
});

test("distinct approved payment IDs can each credit their paid package", () => {
  assert.doesNotMatch(sql, /credit_ledger_purchase_order_unique/);
  assert.match(sql, /'mercado_pago:payment:' \|\| p_provider_payment_id \|\| ':purchase'/);
  assert.match(sql, /reversal\.payment_id = purchase\.payment_id/);
});

test("an anonymized order records payment state but never grants new credit", () => {
  assert.match(sql, /new\.user_id is null and expected_user_id is not null/);
  assert.match(sql, /if p_status = 'approved' and locked_order\.user_id is not null/);
  assert.doesNotMatch(sql, /cannot create payment for an anonymized order/);
});

test("chargeback dominates refund in the aggregate order status", () => {
  assert.match(sql, /from public\.payments where order_id = locked_order\.id and status = 'charged_back'/);
  assert.match(sql, /then 'payment_charged_back'/);
});
