import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a running stack (API on :8000, web on :3000).
// They use whatever providers the API is configured with. For the staging
// test the spec calls for, run the API with real providers, not mocks.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 2,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // Tracing captures screenshots, which crashed the Chromium renderer on the
    // Windows dev machine this was built on. Enable with --trace=on where it works.
    trace: "off",
    // Media-feature emulation (Playwright's default colorScheme: "light") reliably
    // crashed Chromium renderers on the build machine; use the OS setting instead.
    colorScheme: null,
    reducedMotion: null,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "iphone", use: { ...devices["iPhone 14"] } },
  ],
});
