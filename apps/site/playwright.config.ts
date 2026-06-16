import { defineConfig, devices } from "@playwright/test";

const PORT = 4319;
// The build stamps assets under this base (ADR-0022); `vite preview` therefore
// serves the app at `http://localhost:PORT/grove/`, so the suite drives the EXACT
// deployed structure (asset 404s under the subpath would fail here, not just live).
const BASE = process.env.SITE_BASE ?? "/grove/";

/**
 * Render + a11y harness for the Grove launch site (ADR-0021). The site is a
 * prerendered static page (`bun run build` emits the hydratable client bundle,
 * the SSR bundle, and stitches the real section copy into `dist/index.html`);
 * `vite preview` serves that `dist`. No host / globalSetup — unlike the desktop
 * and mobile suites, this surface talks to nothing (it is the landing page), so
 * the tests run against the static output directly.
 *
 * Two projects: a desktop Chrome viewport and a Pixel-5 phone viewport, so the
 * render spec proves the cockpit + every section at both sizes. Driven via node
 * (`node ./node_modules/@playwright/test/cli.js test`) — Playwright + bun is
 * unreliable (see evidence/phase-1); the build step itself may use bun.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // The static build is multi-step (client + SSR + prerender stitch); run the
    // package build, then serve the prerendered `dist` over `vite preview`.
    command: `bun run build && node ./node_modules/vite/bin/vite.js preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
