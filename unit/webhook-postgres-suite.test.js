const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const sql = readFileSync("supabase/tests/mercado_pago_webhook_test.sql", "utf8");

test("webhook PostgreSQL suite is isolated and covers the required lifecycle", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  for (const scenario of [
    "Non-crediting states",
    "idempotent",
    "stale snapshot",
    "Partial refund",
    "full refund",
    "Chargeback dominates refund",
    "Two payments",
    "Anonymized ownership",
    "service-role only",
    "roll back"
  ]) {
    assert.match(sql, new RegExp(scenario, "i"), scenario);
  }
  assert.match(sql, /process_mercado_pago_payment/g);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /has_function_privilege\('service_role'/);
});
