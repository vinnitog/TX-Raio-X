const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const sql = readFileSync("supabase/tests/privacy_rights_test.sql", "utf8");

test("privacy PostgreSQL suite covers isolation, race, retention and anonymization", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /rollback;\s*$/i);
  for (const scenario of [
    "arbitrary account", "another account", "cannot start after erasure",
    "every non-terminal order status", "without provider preference ids",
    "checkout created before erasure", "expired rate limits", "idempotency receipts",
    "anonymizes financial ownership", "reconciles processing audit"
  ]) assert.match(sql, new RegExp(scenario, "i"), scenario);
  assert.match(sql, /has_function_privilege\('authenticated'/);
});
