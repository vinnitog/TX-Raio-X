const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const sql = readFileSync("supabase/migrations/20260822000300_migrate_billing_to_stripe.sql", "utf8").toLowerCase().replace(/\s+/g, " ");

test("Stripe webhook RPC is transactional, idempotent and service-role only", () => {
  assert.match(sql, /create or replace function public\.process_stripe_payment/);
  assert.match(sql, /language plpgsql security definer set search_path = ''/);
  assert.match(sql, /billing_webhook_events[\s\S]*primary key \(provider, provider_environment, provider_event_id\)/);
  assert.match(sql, /insert into public\.billing_webhook_events[\s\S]*on conflict do nothing/);
  assert.match(sql, /revoke all on function public\.process_stripe_payment[\s\S]*public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.process_stripe_payment[\s\S]*service_role/);
});

test("approval and full reversal update ledger once while partial refund stays manual", () => {
  assert.match(sql, /if p_status = 'approved'/);
  assert.match(sql, /p_status = 'refunded' and p_refunded_cents = p_amount_cents/);
  assert.match(sql, /p_status = 'charged_back'/);
  assert.match(sql, /on conflict do nothing/);
  assert.doesNotMatch(sql, /p_status = 'refunded' and p_refunded_cents < p_amount_cents/);
});

test("legacy provider processing is removed without deleting financial rows", () => {
  assert.match(sql, /drop function if exists public\.process_mercado_pago_payment/);
  assert.doesNotMatch(sql, /delete from public\.(orders|payments|credit_ledger)/);
  assert.match(sql, /alter table public\.orders alter column provider set default 'stripe'/);
});

test("partial refund before approval preserves the refund snapshot and still credits once", () => {
  assert.match(sql, /persisted_payment\.status = 'partially_refunded' and p_status = 'approved'/);
  assert.match(sql, /provider_updated_at = greatest\(provider_updated_at, p_provider_updated_at\)/);
  assert.match(sql, /status = 'approved'[\s\S]*on conflict do nothing/);
});

test("checkout creation is account-scoped and expiration cannot regress terminal orders", () => {
  assert.match(sql, /orders_one_open_stripe_checkout_per_user/);
  assert.match(sql, /create_or_get_stripe_checkout_order/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('privacy-erasure:' \|\| p_user_id::text/);
  assert.match(sql, /locked_order\.status in \('payment_approved', 'payment_refunded', 'payment_charged_back'\) then return false/);
});
test("card failure keeps its Checkout Session reusable while async failure is terminal", () => {
  assert.match(sql, /p_event_type = 'payment_intent\.payment_failed'[\s\S]*then case[\s\S]*checkout_ready/);
  assert.match(sql, /else 'payment_' \|\| p_status/);
});

test("partial to approved exception never bypasses payment identity validation", () => {
  const identityCheck = sql.match(/if has_existing_payment and \([\s\S]*?provider payment identity conflict/)[0];
  assert.match(identityCheck, /persisted_payment\.order_id is distinct from locked_order\.id/);
  assert.doesNotMatch(identityCheck, /partially_refunded/);
});