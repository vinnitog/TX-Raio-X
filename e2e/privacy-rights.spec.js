import { expect, test } from "@playwright/test";
import { E2E_SESSION, mockSupabase } from "./support/mock-supabase.mjs";

test.beforeEach(async ({ page }) => {
  await mockSupabase(page, { session: E2E_SESSION });
  await page.goto("/");
  await page.locator("#account-button").click();
});

test("authenticated account exposes a downloadable structured export", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#privacy-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("tx-raio-x-meus-dados.json");
  await expect(page.locator("#privacy-feedback")).toContainText("Arquivo preparado");
});

test("account deletion requires navigation plus exact typed email", async ({ page }) => {
  await page.locator("#privacy-delete-start").click();
  await expect(page.locator("#privacy-delete-warning")).toContainText("bloqueada se houver saldo pago");
  await expect(page.locator("#privacy-delete-confirmation")).toHaveAttribute(
    "aria-describedby",
    /privacy-delete-warning/
  );
  await page.locator("#privacy-delete-confirmation").fill("outro@example.com");
  await page.locator("#privacy-delete-confirm").click();
  await expect(page.locator("#privacy-delete-feedback")).toContainText("exatamente o e-mail");

  await page.locator("#privacy-delete-confirmation").fill(E2E_SESSION.user.email);
  await page.locator("#privacy-delete-confirm").click();
  await expect(page.locator("#auth-dialog")).not.toBeVisible();
  await expect(page.locator("#account-button-label")).toHaveText("Entrar");
});
