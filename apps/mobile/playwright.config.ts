import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/host-fixture.ts";

/**
 * Phone-viewport e2e for the Grove PWA (ADR-0014 / W6 foundation). A REAL host is
 * started in `globalSetup` that ALSO serves the built PWA same-origin, so the
 * browser loads the app from the host and makes genuine tRPC + `/sync` calls — the
 * pairing spec redeems a real single-use code and asserts the real workspace list.
 * Driven via node (Playwright + bun is unreliable on Windows; see evidence/phase-1).
 *
 * `_*.spec.ts` are reserved for measurement/evidence specs and excluded from the
 * default (behavioural) run; lift the ignore with GROVE_E2E_MEASURE=1.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.GROVE_E2E_MEASURE ? [] : ["**/_*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  use: {
    ...devices["Pixel 5"],
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
});
