import { defineConfig, devices } from "@playwright/test";

const PORT = 4318;

/**
 * Renderer smoke harness. The renderer is built with Vite and served headlessly
 * by `vite preview`; a REAL Grove host is started in `globalSetup` (seeded over
 * the engine's own store), and the connected test injects its `{endpoint, token}`
 * so the renderer makes genuine tRPC + sync calls — no stubbed happy path. Driven
 * via node (Playwright + bun is unreliable on Windows; see evidence/phase-1).
 */
export default defineConfig({
  testDir: "./e2e",
  // `_*.spec.ts` are measurement/evidence tools (perf timings, axe audit, QA
  // screenshots), not behavioural gates — they are slow and timing-sensitive
  // (cold-shell variance), so they are excluded from the default `playwright test`
  // run (incl. the CI e2e job). Run them explicitly, e.g.
  // `node ./node_modules/@playwright/test/cli.js test _perf.spec.ts`.
  testIgnore: ["**/_*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js build && node ./node_modules/vite/bin/vite.js preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
