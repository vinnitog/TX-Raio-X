import { expect, test } from "@playwright/test";
import { E2E_SESSION, mockSupabase } from "./support/mock-supabase.mjs";

test.beforeEach(async ({ page }) => {
  await mockSupabase(page);
});

test("guest must authenticate before a real analysis", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#usage-text")).toHaveText("Entre para liberar 2 grátis");

  await page.locator("#transaction-hash").fill(`0x${"a".repeat(64)}`);
  await page.locator("#analyze-button").click();

  await expect(page.locator("#hash-error")).toContainText("Entre ou crie uma conta");
  await expect(page.locator("#auth-dialog")).toBeVisible();
});

test("email signup, confirmed login, reload and logout preserve the account contract", async ({ page }) => {
  await page.goto("/");
  await page.locator("#account-button").click();
  await page.locator("#auth-switch-mode").click();
  await page.locator("#auth-email").fill("nova.conta@example.com");
  await page.locator("#auth-password").fill("SenhaForte123");
  await page.locator("#auth-submit").click();
  await expect(page.locator("#auth-feedback")).toContainText("Confira seu e-mail");

  await page.locator("#auth-switch-mode").click();
  await page.locator("#auth-email").fill(E2E_SESSION.user.email);
  await page.locator("#auth-password").fill("SenhaForte123");
  await page.locator("#auth-submit").click();

  await expect(page.locator("#account-button-label")).toHaveText(E2E_SESSION.user.email);
  await expect(page.locator("#usage-text")).toHaveText("2 análises grátis");
  await page.reload();
  await expect(page.locator("#account-button-label")).toHaveText(E2E_SESSION.user.email);
  await expect(page.locator("#usage-text")).toHaveText("2 análises grátis");

  await page.locator("#account-button").click();
  await page.locator("#auth-logout").click();
  await expect(page.locator("#account-button-label")).toHaveText("Entrar");
  await expect(page.locator("#usage-text")).toHaveText("Entre para liberar 2 grátis");
});

test("Google uses the clean deployment URL and recovery accepts a new password", async ({ page }) => {
  await page.goto("/?tracking=discarded#fragment");
  await page.locator("#account-button").click();
  await page.locator("#auth-google-button").click();
  await expect.poll(() => page.evaluate(() => window.__txRaioXE2E.getGoogleRedirect()))
    .toBe("http://txraiox.test:4173/");

  await page.locator("#auth-email").fill("recuperacao@example.com");
  await page.locator("#auth-forgot-password").click();
  await expect(page.locator("#auth-feedback")).toContainText("enviaremos as instruções");

  await page.evaluate((session) => window.__txRaioXE2E.emit("PASSWORD_RECOVERY", session), E2E_SESSION);
  await expect(page.locator("#recovery-form")).toBeVisible();
  await page.locator("#recovery-password").fill("NovaSenha123");
  await page.locator("#recovery-password-confirmation").fill("NovaSenha123");
  await page.locator("#recovery-submit").click();
  await expect(page.locator("#auth-dialog")).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("txraiox:e2e:updated-password-length")))
    .toBe("12");
});

test("authenticated hosted analysis is delivered by the protected endpoint and updates allowance", async ({ page }) => {
  await page.addInitScript((session) => {
    localStorage.setItem("txraiox:e2e:session", JSON.stringify(session));
  }, E2E_SESSION);
  await page.goto("/");
  await expect(page.locator("#usage-text")).toHaveText("2 análises grátis");

  await page.locator("#transaction-hash").fill(`0x${"a".repeat(64)}`);
  await page.locator("#network").selectOption("base");
  await page.locator("#analyze-button").click();

  await expect(page.locator("#result-title")).toHaveText("Uma autorização foi concedida");
  await expect(page.locator("#usage-text")).toHaveText("1 análise grátis");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tx-raio-x:usage:v1")))
    .toBeNull();
});
