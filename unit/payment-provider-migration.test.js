const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function filesUnder(directory) {
  const absolute = path.join(root, directory);
  return readdirSync(absolute, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".env.local")).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

test("active runtime contains Stripe only and no Mercado Pago integration", () => {
  const activeFiles = [
    ...filesUnder("supabase/functions"),
    ...filesUnder("js"),
    "index.html",
    "privacidade.html",
    "termos.html",
    "supabase/config.toml"
  ];
  for (const file of activeFiles) {
    const content = read(file);
    assert.doesNotMatch(content, /MERCADO_PAGO|mercadopago|mercado_pago|Mercado Pago/i, file);
  }
  assert.equal(existsSync(path.join(root, "supabase/functions/mercado-pago-webhook/index.ts")), false);
  assert.equal(existsSync(path.join(root, "supabase/functions/_shared/mercado-pago-webhook.mjs")), false);
});

test("Stripe API contract, account-scoped checkout and immutable Price snapshot are pinned", () => {
  const checkoutEntry = read("supabase/functions/checkout/index.ts");
  const webhookEntry = read("supabase/functions/stripe-webhook/index.ts");
  const checkout = read("supabase/functions/_shared/checkout.mjs");
  const migration = read("supabase/migrations/20260822000300_migrate_billing_to_stripe.sql");
  assert.match(checkout, /STRIPE_API_VERSION = "2026-02-25\.clover"/);
  assert.match(checkoutEntry, /"Stripe-Version": STRIPE_API_VERSION/);
  assert.match(webhookEntry, /"Stripe-Version": STRIPE_API_VERSION/);
  assert.match(migration, /create unique index orders_one_open_stripe_checkout_per_user/i);
  assert.match(migration, /create_or_get_stripe_checkout_order/i);
  assert.match(migration, /idempotency_key = p_idempotency_key[\s\S]*payment_rejected/i);
  assert.match(migration, /status in \('creating_checkout', 'checkout_unknown', 'checkout_ready'\)/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('privacy-erasure:' \|\| p_user_id::text/i);
  assert.match(migration, /new\.provider_price_id is distinct from old\.provider_price_id/i);
  assert.match(checkout, /buildStripeCheckoutPayload\(order\.id, order\.provider_price_id/i);
});

test("remote Mercado Pago cutover is explicit and preserves historical financial rows", () => {
  const guide = read("docs/STRIPE_E2E.md");
  const migration = read("supabase/migrations/20260822000300_migrate_billing_to_stripe.sql");
  assert.match(guide, /supabase functions delete mercado-pago-webhook/);
  assert.match(guide, /supabase secrets unset MERCADO_PAGO_ENVIRONMENT/);
  assert.doesNotMatch(migration, /delete from public\.(orders|payments|credit_ledger)/i);
  assert.doesNotMatch(migration, /truncate\s+(table\s+)?public\.(orders|payments|credit_ledger)/i);
  assert.doesNotMatch(migration, /update public\.(orders|payments)\s+set\s+provider\s*=\s*['"]stripe['"]/i);
  assert.match(migration, /provider <> 'stripe' and provider_price_id is null/i);
});
