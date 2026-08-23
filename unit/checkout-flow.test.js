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

function fakeCheckoutWindow({
  blocked = false,
  closed = false,
  openerIgnored = false,
  openerThrows = false,
  openerGetterThrows = false,
  replaceThrows = false
} = {}) {
  const calls = [];
  let opener = { unsafe: true };
  const tab = {
    closed,
    location: {
      replace(url) {
        if (replaceThrows) throw new Error("navigation blocked");
        calls.push(["replace", url]);
      }
    },
    close() {
      calls.push(["close"]);
      this.closed = true;
    }
  };
  Object.defineProperty(tab, "opener", {
    configurable: true,
    get() {
      if (openerGetterThrows) throw new Error("opener getter protected");
      return opener;
    },
    set(value) {
      if (openerThrows) throw new Error("opener protected");
      if (!openerIgnored) opener = value;
    }
  });
  return {
    calls,
    tab,
    window: {
      open(...args) {
        calls.push(["open", ...args]);
        return blocked ? null : tab;
      }
    }
  };
}

test("checkout tab opens synchronously without an opener and navigates after checkout is ready", async () => {
  const { openCheckoutTab } = await import("../js/checkout-flow.mjs");
  const browser = fakeCheckoutWindow();
  const checkoutTab = openCheckoutTab(browser.window);

  assert.deepEqual(browser.calls, [["open", "about:blank", "_blank"]]);
  assert.equal(browser.tab.opener, null);
  assert.equal(checkoutTab.navigate("https://checkout.stripe.com/c/pay/cs_test_one"), true);
  assert.deepEqual(browser.calls.at(-1), ["replace", "https://checkout.stripe.com/c/pay/cs_test_one"]);
});

test("checkout tab fails closed when popup or delayed navigation is unavailable", async () => {
  const { openCheckoutTab } = await import("../js/checkout-flow.mjs");
  assert.equal(openCheckoutTab(fakeCheckoutWindow({ blocked: true }).window), null);

  const closed = fakeCheckoutWindow({ closed: true });
  assert.equal(openCheckoutTab(closed.window).navigate("https://checkout.stripe.com/c/pay/cs_test_one"), false);
  assert.equal(closed.calls.some(([name]) => name === "replace"), false);

  const rejected = fakeCheckoutWindow({ replaceThrows: true });
  assert.equal(openCheckoutTab(rejected.window).navigate("https://checkout.stripe.com/c/pay/cs_test_one"), false);
});

test("checkout tab is discarded when opener isolation cannot be guaranteed", async () => {
  const { openCheckoutTab } = await import("../js/checkout-flow.mjs");
  for (const browser of [
    fakeCheckoutWindow({ openerIgnored: true }),
    fakeCheckoutWindow({ openerThrows: true }),
    fakeCheckoutWindow({ openerGetterThrows: true })
  ]) {
    assert.equal(openCheckoutTab(browser.window), null);
    assert.equal(browser.tab.closed, true);
    assert.equal(browser.calls.filter(([name]) => name === "close").length, 1);
  }
});

test("failed popup and same-tab navigation is contained and closes the auxiliary tab", async () => {
  const { navigateToCheckout, openCheckoutTab } = await import("../js/checkout-flow.mjs");
  const browser = fakeCheckoutWindow({ replaceThrows: true });
  const checkoutTab = openCheckoutTab(browser.window);
  const destination = navigateToCheckout(checkoutTab, "https://checkout.stripe.com/c/pay/cs_test_one", {
    assign() { throw new Error("same-tab navigation blocked"); }
  });
  assert.equal(destination, "failed");
  assert.equal(browser.tab.closed, true);
  assert.equal(browser.calls.filter(([name]) => name === "close").length, 1);
});

test("failed or blocked new-tab navigation closes it before same-tab fallback", async () => {
  const { navigateToCheckout, openCheckoutTab } = await import("../js/checkout-flow.mjs");
  for (const browser of [
    fakeCheckoutWindow({ blocked: true }),
    fakeCheckoutWindow({ replaceThrows: true })
  ]) {
    const assignments = [];
    const checkoutTab = openCheckoutTab(browser.window);
    const destination = navigateToCheckout(
      checkoutTab,
      "https://checkout.stripe.com/c/pay/cs_test_one",
      { assign: (url) => assignments.push(url) }
    );

    assert.equal(destination, "same_tab");
    assert.deepEqual(assignments, ["https://checkout.stripe.com/c/pay/cs_test_one"]);
    if (checkoutTab) assert.equal(browser.tab.closed, true);
  }
});

test("unused checkout tab closes after authentication or checkout failure", async () => {
  const { openCheckoutTab } = await import("../js/checkout-flow.mjs");
  const browser = fakeCheckoutWindow();
  const checkoutTab = openCheckoutTab(browser.window);
  checkoutTab.close();
  checkoutTab.close();

  assert.equal(browser.tab.closed, true);
  assert.equal(browser.calls.filter(([name]) => name === "close").length, 1);
});

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
      `https://app.example.com/?campaign=beta&checkout_status=${status}&session_id=cs_test_123&source=checkout#result`
    );
    const cleaned = new URL(result.cleanedUrl);

    assert.equal(result.status, status);
    assert.equal(cleaned.searchParams.get("campaign"), "beta");
    assert.equal(cleaned.searchParams.has("checkout_status"), false);
    assert.equal(cleaned.searchParams.has("session_id"), false);
    assert.equal(cleaned.searchParams.has("source"), false);
    assert.equal(cleaned.hash, "#result");
    assert.deepEqual(usage, before);
  });
}

test("checkout return removes every Stripe return parameter", async () => {
  const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  const result = sanitizeCheckoutReturn(
    "https://app.example.com/?campaign=beta&checkout_status=success&session_id=cs_test_123&source=checkout#result"
  );
  const cleaned = new URL(result.cleanedUrl);

  assert.equal(result.status, "success");
  assert.equal(cleaned.search, "?campaign=beta");
  assert.equal(cleaned.hash, "#result");
});

test("checkout return preserves Supabase auth parameters and fragment", async () => {
  const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  const result = sanitizeCheckoutReturn(
    "https://app.example.com/?checkout_status=success&session_id=cs_test_123&source=checkout&code=auth-code&type=recovery&next=%2Faccount#recovery"
  );
  const cleaned = new URL(result.cleanedUrl);

  assert.equal(cleaned.searchParams.get("code"), "auth-code");
  assert.equal(cleaned.searchParams.get("type"), "recovery");
  assert.equal(cleaned.searchParams.get("next"), "/account");
  assert.equal(cleaned.searchParams.has("session_id"), false);
  assert.equal(cleaned.hash, "#recovery");
});

test("ordinary auth return without checkout marker is left untouched", async () => {
  const { sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  assert.deepEqual(
    sanitizeCheckoutReturn("https://app.example.com/?code=auth-code&type=recovery#account"),
    { status: null, cleanedUrl: null }
  );
});

test("checkout return cleanup never interrupts initialization when history throws", async () => {
  const { replaceCheckoutReturn, sanitizeCheckoutReturn } = await import("../js/checkout-flow.mjs");
  const usage = { credits: 4, freeUsed: 2 };
  const result = sanitizeCheckoutReturn("https://app.example.com/?checkout_status=success&session_id=cs_test_123&source=checkout");
  assert.equal(replaceCheckoutReturn({
    replaceState() { throw new Error("history blocked"); }
  }, result.cleanedUrl), false);
  assert.deepEqual(usage, { credits: 4, freeUsed: 2 });
});

test("orchestrated auth_required closes the blank tab, restores loading and starts once", async () => {
  const { createCheckoutLoadingController, openCheckoutTab, runCheckoutAttempt } = await import("../js/checkout-flow.mjs");
  const browser = fakeCheckoutWindow();
  const loading = createCheckoutLoadingController([fakeButton(), fakeButton()]);
  let starts = 0;
  let authOpens = 0;
  const outcome = await runCheckoutAttempt({
    loading,
    openTab: () => openCheckoutTab(browser.window),
    startCheckout: async () => { starts += 1; return { status: "auth_required" }; },
    openAuth: async () => { authOpens += 1; return true; },
    navigate: () => assert.fail("auth flow must not navigate")
  });
  assert.deepEqual(outcome, { status: "auth_required" });
  assert.equal(starts, 1);
  assert.equal(authOpens, 1);
  assert.equal(browser.tab.closed, true);
  assert.equal(loading.tryStart(), true, "loading must be restored");
});

test("closed tab while checkout waits falls back once to same-tab navigation", async () => {
  const { createCheckoutLoadingController, navigateToCheckout, openCheckoutTab, runCheckoutAttempt } = await import("../js/checkout-flow.mjs");
  const browser = fakeCheckoutWindow();
  const buttons = [fakeButton(), fakeButton()];
  const loading = createCheckoutLoadingController(buttons);
  let resolveCheckout;
  let starts = 0;
  const pendingCheckout = new Promise((resolve) => { resolveCheckout = resolve; });
  const assignments = [];
  const options = {
    loading,
    openTab: () => openCheckoutTab(browser.window),
    startCheckout: async () => { starts += 1; return pendingCheckout; },
    openAuth: () => false,
    navigate: (tab, url) => navigateToCheckout(tab, url, { assign: (value) => assignments.push(value) })
  };
  const first = runCheckoutAttempt(options);
  const second = await runCheckoutAttempt(options);
  assert.deepEqual(second, { status: "busy" });
  browser.tab.closed = true;
  resolveCheckout({ status: "ready", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_one" });
  assert.deepEqual(await first, { status: "same_tab" });
  assert.equal(starts, 1);
  assert.deepEqual(assignments, ["https://checkout.stripe.com/c/pay/cs_test_one"]);
  assert.equal(buttons.every((button) => button.disabled), true);
});
