const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const sql = readFileSync("supabase/tests/stripe_webhook_test.sql", "utf8");

test("Stripe PostgreSQL suite covers approval, replay, refund, dispute and privileges", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  for (const scenario of ["legacy Mercado Pago financial rows", "account-scoped checkout", "card failure", "checkout reusable", "approval", "repeated event", "partial refund", "full refund", "dispute", "expiration", "partial refund can arrive before approval", "late approval", "canonical payment status", "preserves the earlier partial refund amount", "exact retry", "different key", "service-role only"]) assert.match(sql, new RegExp(scenario, "i"), scenario);
  assert.match(sql, /process_stripe_payment/g);
});
