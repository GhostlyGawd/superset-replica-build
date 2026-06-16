// Live-deploy smoke check (ADR-0022): drive the REAL GitHub Pages URL in a
// browser, not the local build — prove the page renders, every asset resolves
// under the base (no 4xx), the prerendered copy is present, the JS islands
// hydrate (crank the SWARM DIAL + open the command palette), and capture a
// full-page screenshot to evidence/site/deploy-live.png. Re-runnable for any
// future redeploy: `node apps/site/scripts/verify-live.mjs` (LIVE_URL overrides).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const evidence = resolve(here, "../../../evidence/site");
const LIVE_URL = process.env.LIVE_URL ?? "https://ghostlygawd.github.io/grove/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const badResponses = [];
const failedRequests = [];
page.on("response", (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});
page.on("requestfailed", (r) => {
  failedRequests.push(`${r.failure()?.errorText ?? "failed"} ${r.url()}`);
});

await page.goto(LIVE_URL, { waitUntil: "networkidle", timeout: 30_000 });

// Prerendered copy + the signature section render.
await page
  .getByRole("heading", { name: "Run a swarm of coding agents. Keep one calm surface." })
  .waitFor({ timeout: 15_000 });

// Hydration proof: cranking the dial (a pull) recomputes the caption from the
// same number — only possible if the JS bundle loaded + hydrated over the static
// HTML at the base path.
const dial = page.getByRole("slider", { name: /number of agents/i });
await dial.scrollIntoViewIfNeeded();
await dial.fill("64");
await page.getByText(/64 agents · 64 worktrees/).waitFor({ timeout: 10_000 });

// Second hydration proof: the command-palette island opens.
await page.getByRole("button", { name: "Open command palette" }).click();
await page.getByRole("dialog", { name: "Command palette" }).waitFor({ timeout: 10_000 });
await page.keyboard.press("Escape");

await page.screenshot({ path: resolve(evidence, "deploy-live.png"), fullPage: true });
await browser.close();

const ok = badResponses.length === 0 && failedRequests.length === 0;
console.log(`LIVE_URL=${LIVE_URL}`);
console.log(`bad responses (>=400): ${badResponses.length}`, badResponses);
console.log(`failed requests: ${failedRequests.length}`, failedRequests);
console.log(ok ? "LIVE OK — rendered, hydrated, 0 asset failures" : "LIVE FAIL");
if (!ok) process.exitCode = 1;
