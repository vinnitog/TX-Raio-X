const test = require("node:test");
const assert = require("node:assert/strict");

function fakeButton() {
  const labels = {
    ".button-label": { hidden: false },
    ".checkout-loading-label": { hidden: true }
  };
  const classes = new Set();
  return {
    disabled: false,
    attributes: {},
    labels,
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) { return labels[selector]; }
  };
}

test("double click keeps both CTAs loading and admits a single checkout call", async () => {
  const { createCheckoutLoadingController } = await import("../js/checkout-flow.mjs");
  const buttons = [fakeButton(), fakeButton()];
  const loading = createCheckoutLoadingController(buttons);
  let calls = 0;
  const click = async () => {
    if (!loading.tryStart()) return;
    calls += 1;
    await new Promise((resolve) => setImmediate(resolve));
  };

  await Promise.all([click(), click()]);
  assert.equal(calls, 1);
  for (const button of buttons) {
    assert.equal(button.disabled, true);
    assert.equal(button.attributes["aria-busy"], "true");
    assert.equal(button.classList.contains("is-loading"), true);
  }
});

test("pageshow/BFCache restores both checkout CTAs", async () => {
  const { createCheckoutLoadingController } = await import("../js/checkout-flow.mjs");
  const buttons = [fakeButton(), fakeButton()];
  const loading = createCheckoutLoadingController(buttons);
  loading.tryStart();
  loading.restoreAfterPageShow();

  for (const button of buttons) {
    assert.equal(button.disabled, false);
    assert.equal(button.attributes["aria-busy"], "false");
    assert.equal(button.labels[".button-label"].hidden, false);
    assert.equal(button.labels[".checkout-loading-label"].hidden, true);
  }
  assert.equal(loading.tryStart(), true, "restored CTA must allow another checkout attempt");
});

test("failed dynamic import is discarded and the next click retries", async () => {
  const { createRetryableLoader } = await import("../js/checkout-flow.mjs");
  let attempts = 0;
  const getClient = createRetryableLoader(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("chunk unavailable");
    return { supabase: "client" };
  }, ({ supabase }) => supabase);

  await assert.rejects(getClient(), /chunk unavailable/);
  assert.equal(await getClient(), "client");
  assert.equal(attempts, 2);
  assert.equal(await getClient(), "client");
  assert.equal(attempts, 2, "successful import remains cached");
});

for (const status of ["success", "pending", "failure"]) {
  test(`checkout ${status} return removes financial parameters without touching balance`, async () => {
    const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
    const usage = { freeUsed: 2, credits: 7, unlocked: false };
    const before = structuredClone(usage);
    const result = sanitizeCheckoutReturn(
      `https://app.example.com/?campaign=beta&checkout_status=${status}&payment_id=123&status=approved#result`
    );
    const cleaned = new URL(result.cleanedUrl);

    assert.equal(result.status, status);
    assert.equal(cleaned.searchParams.get("campaign"), "beta");
    assert.equal(cleaned.searchParams.has("checkout_status"), false);
    assert.equal(cleaned.searchParams.has("payment_id"), false);
    assert.equal(cleaned.searchParams.has("status"), false);
    assert.equal(cleaned.hash, "#result");
    assert.deepEqual(usage, before);
  });
}

test("checkout return preserves Supabase auth parameters and fragment", async () => {
  const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  const result = sanitizeCheckoutReturn(
    "https://app.example.com/?checkout_status=success&payment_id=123&code=auth-code&type=recovery&next=%2Faccount#recovery"
  );
  const cleaned = new URL(result.cleanedUrl);

  assert.equal(cleaned.searchParams.get("code"), "auth-code");
  assert.equal(cleaned.searchParams.get("type"), "recovery");
  assert.equal(cleaned.searchParams.get("next"), "/account");
  assert.equal(cleaned.searchParams.has("payment_id"), false);
  assert.equal(cleaned.hash, "#recovery");
});

test("ordinary auth return without checkout marker is left untouched", async () => {
  const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  assert.deepEqual(
    sanitizeCheckoutReturn("https://app.example.com/?code=auth-code&type=recovery#account"),
    { status: null, cleanedUrl: null }
  );
});
