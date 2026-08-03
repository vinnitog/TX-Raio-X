import { expect, test } from "@playwright/test";
import {
  E2E_SESSION,
  createSharedEntitlementBackend,
  mockSupabase
} from "./support/mock-supabase.mjs";

const ACCOUNT_B = Object.freeze({
  access_token: "e2e-token-b",
  user: {
    id: "10000000-0000-4000-8000-000000000002",
    email: "conta.b.e2e@example.com"
  }
});

async function analyze(page, suffix) {
  await page.locator("#transaction-hash").fill(`0x${suffix.repeat(64)}`);
  await page.locator("#network").selectOption("base");
  await page.locator("#analyze-button").click();
  await expect(page.locator("#result-title")).toHaveText("Uma autoriza\u00e7\u00e3o foi concedida");
}

test("the same account recovers shared balance across two devices after consumption and reversal", async ({ browser }) => {
  const backend = createSharedEntitlementBackend({
    [E2E_SESSION.user.id]: { balance: 2, freeRemaining: 0, hasPaidAccess: true }
  });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await mockSupabase(pageA, { session: E2E_SESSION, sharedBackend: backend });
  await mockSupabase(pageB, { session: E2E_SESSION, sharedBackend: backend });

  await Promise.all([pageA.goto("/"), pageB.goto("/")]);
  await expect(pageA.locator("#usage-text")).toHaveText("Saldo: 2 an\u00e1lises");
  await expect(pageB.locator("#usage-text")).toHaveText("Saldo: 2 an\u00e1lises");

  await analyze(pageA, "a");
  await expect(pageA.locator("#usage-text")).toHaveText("Saldo: 1 an\u00e1lise");
  expect(backend.snapshot(E2E_SESSION.user.id).balance).toBe(1);

  await pageB.reload();
  await expect(pageB.locator("#usage-text")).toHaveText("Saldo: 1 an\u00e1lise");

  backend.reverse(E2E_SESSION.user.id);
  await Promise.all([pageA.reload(), pageB.reload()]);
  await expect(pageA.locator("#usage-text")).toHaveText("An\u00e1lises extras esgotadas");
  await expect(pageB.locator("#usage-text")).toHaveText("An\u00e1lises extras esgotadas");
  expect(backend.snapshot(E2E_SESSION.user.id)).toEqual({
    balance: 0, freeRemaining: 0, hasPaidAccess: false
  });

  await contextA.close();
  await contextB.close();
});

test("switching A to B clears A entitlement before B query completes", async ({ page }) => {
  const backend = createSharedEntitlementBackend({
    [E2E_SESSION.user.id]: { balance: 7, freeRemaining: 1, hasPaidAccess: true },
    [ACCOUNT_B.user.id]: { balance: 0, freeRemaining: 2, hasPaidAccess: false }
  });
  await mockSupabase(page, { session: E2E_SESSION, sharedBackend: backend });
  await page.goto("/");
  await expect(page.locator("#usage-text")).toHaveText("Saldo: 7 + 1 gr\u00e1tis");

  backend.setDelay(ACCOUNT_B.user.id, 400);
  await page.evaluate((session) => window.__txRaioXE2E.emit("SIGNED_IN", session), ACCOUNT_B);
  await expect(page.locator("#usage-text")).toHaveText("Carregando saldo\u2026");
  await expect(page.locator("#usage-text")).toHaveText("2 an\u00e1lises gr\u00e1tis");
  await expect(page.locator("#usage-text")).not.toContainText("7");
});
