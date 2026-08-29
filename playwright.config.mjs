import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://txraiox.test:4173",
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    serviceWorkers: "block",
    launchOptions: {
      args: ["--host-resolver-rules=MAP txraiox.test 127.0.0.1"]
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
