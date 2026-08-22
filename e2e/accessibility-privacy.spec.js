import { expect, test } from "@playwright/test";
import { E2E_SESSION, mockSupabase } from "./support/mock-supabase.mjs";

test("skip link is first in the keyboard order and moves focus to main content", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/");

  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await expect(page.locator(".skip-link")).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page).toHaveURL(/#main-content$/);
});

for (const legalPage of [
  { label: "privacidade", linkName: "Privacidade" },
  { label: "termos", linkName: "Termos do beta" }
]) {
  test(`returning from ${legalPage.label} never exposes the unfocused skip link`, async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/");
    await page.getByRole("link", { name: legalPage.linkName, exact: true }).click();
    await page.getByRole("link", { name: "Voltar ao Tx Raio-X" }).click();

    const skipLink = page.locator(".skip-link");
    await expect(skipLink).not.toBeFocused();
    await expect(skipLink).toHaveCSS("opacity", "0");

    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await expect(skipLink).toHaveCSS("opacity", "1");
  });
}

test("history return at 320px keeps the skip link hidden until the first Tab", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockSupabase(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Privacidade", exact: true }).click();
  await expect(page).toHaveURL(/\/privacidade\.html$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  const skipLink = page.locator(".skip-link");
  await expect(skipLink).not.toBeFocused();
  await expect(skipLink).toHaveCSS("opacity", "0");

  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("opacity", "1");
});

test("guest privacy link receives focus and navigates from the auth dialog", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/");
  await page.locator("#account-button").click();

  const privacyLink = page.getByRole("link", { name: "Como tratamos seus dados" });
  await expect(privacyLink).toBeVisible();
  await privacyLink.focus();
  await expect(privacyLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/privacidade\.html$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seus segredos n\u00e3o entram aqui.");
});

test("authenticated privacy link receives focus and navigates from the account dialog", async ({ page }) => {
  await mockSupabase(page, { session: E2E_SESSION });
  await page.goto("/");
  await page.locator("#account-button").click();

  const privacyLink = page.getByRole("link", { name: "Privacidade e dados da conta" });
  await expect(privacyLink).toBeVisible();
  await privacyLink.focus();
  await expect(privacyLink).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/privacidade\.html$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seus segredos n\u00e3o entram aqui.");
});

test("reduced motion disables transitions and animations in computed styles", async ({ page }) => {
  await mockSupabase(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const styles = await page.evaluate(() => ({
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    skipTransition: getComputedStyle(document.querySelector(".skip-link")).transitionDuration,
    buttonTransition: getComputedStyle(document.querySelector(".primary-button")).transitionDuration,
    spinnerAnimation: getComputedStyle(document.querySelector(".button-spinner")).animationName
  }));
  expect(styles).toEqual({
    scrollBehavior: "auto",
    skipTransition: "0s",
    buttonTransition: "0s",
    spinnerAnimation: "none"
  });
});
