import { expect, test } from "@playwright/test";
import { E2E_SESSION, mockSupabase } from "./support/mock-supabase.mjs";

const returns = [
  ["approved", "success", "Aguardando o webhook confirmar"],
  ["pending", "pending", "está pendente"],
  ["rejected", "failure", "não foi concluído"],
  ["cancelled", "failure", "não foi concluído"]
];

for (const [scenario, checkoutStatus, message] of returns) {
  test(`${scenario} return is cleaned and never grants client-side credit`, async ({ page }) => {
    await mockSupabase(page, { session: E2E_SESSION, entitlement: {
      balance: 0, freeRemaining: 0, hasPaidAccess: false
    } });
    await page.goto(`/?checkout_status=${checkoutStatus}&status=${scenario}&payment_id=123&external_reference=order-e2e&merchant_account_id=null`);

    await expect(page.locator("#toast")).toContainText(message);
    await expect.poll(() => page.url()).toBe("http://txraiox.test:4173/");
    await expect(page.locator("#usage-text")).toHaveText("Análises extras esgotadas");
    const localUsage = await page.evaluate(() => localStorage.getItem("tx-raio-x:usage:v1"));
    expect(localUsage).toBeNull();
  });
}

test("authenticated purchase sends the Mercado Pago sandbox checkout to an isolated tab", async ({ page }) => {
  await mockSupabase(page, { session: E2E_SESSION, entitlement: {
    balance: 0, freeRemaining: 2, hasPaidAccess: false
  } });
  await page.addInitScript(() => {
    if (!crypto.randomUUID) {
      Object.defineProperty(crypto, "randomUUID", {
        value: () => "30000000-0000-4000-8000-000000000001"
      });
    }
    window.__txRaioXOpenedTab = { url: null, closed: false, opener: null };
    window.open = (_url, target) => {
      window.__txRaioXOpenedTab.target = target;
      return {
        get opener() { return null; },
        set opener(_value) {},
        get closed() { return window.__txRaioXOpenedTab.closed; },
        location: {
          replace(url) { window.__txRaioXOpenedTab.url = url; }
        },
        close() { window.__txRaioXOpenedTab.closed = true; }
      };
    };
  });
  await page.goto("/");

  await page.locator("#price-unlock-button").click();

  await expect.poll(() => page.evaluate(() => window.__txRaioXOpenedTab)).toEqual({
    url: "https://sandbox.mercadopago.com/checkout/v1/redirect/e2e",
    closed: false,
    opener: null,
    target: "_blank"
  });
  await expect(page.locator("#toast")).toContainText("Checkout aberto em uma nova aba");
});
