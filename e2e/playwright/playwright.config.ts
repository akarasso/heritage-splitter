import { defineConfig } from "@playwright/test";

const FRONTEND_PORT = parseInt(process.env.E2E_FRONTEND_PORT || "8877");
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || `http://localhost:${FRONTEND_PORT}`;
const SLOW_MO = parseInt(process.env.SLOW_MO || "0");

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./helpers/global-setup.ts",
  globalTeardown: "./helpers/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 120_000,
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      slowMo: SLOW_MO,
    },
  },
  projects: [
    {
      name: "full-story",
      testMatch: /full-story\.spec\.ts/,
    },
  ],
});
