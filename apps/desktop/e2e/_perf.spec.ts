import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { CONN_FILE } from "./host-fixture.ts";

/**
 * Phase-3 performance measurement harness (spec §6.4). This is a MEASUREMENT TOOL,
 * not a product spec: it drives the real, connected renderer against the live host
 * booted in `global-setup.ts` (real tRPC + sync + PTY — no mocks) and records timing
 * distributions. It deliberately makes no budget assertions; PASS/OVER vs the §6.4
 * budgets is evaluated honestly in `evidence/phase-3/perf-report.md`. The only
 * assertions are sanity guards that each measurement actually gathered its samples.
 *
 * Numbers land in a machine-readable JSON next to the host conn file so the report
 * is authored from real data rather than transcribed by hand.
 */

interface Conn {
  readonly endpoint: string;
  readonly token: string;
}

declare global {
  interface Window {
    __coldMs?: number;
    __probe?: { hit: number | null };
  }
}

type Probe =
  | { readonly kind: "dialogOpen" }
  | { readonly kind: "selectionChanged"; readonly from: string }
  | { readonly kind: "streamContains"; readonly marker: string };

const RESULTS_FILE = join(tmpdir(), "grove-perf-results.json");
// A second, repo-relative copy of the results so CI can upload it as an artifact
// (the OS temp dir isn't a stable upload path). Lives next to this app, gitignored.
const UPLOAD_RESULTS_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "grove-perf-results.json",
);
const SELECTED = '[data-testid="workspace-rail"] [aria-current="true"]';
const STREAM = '[data-testid="terminal-stream"]';

function readConn(): Conn {
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

/** Nearest-rank-with-interpolation percentile over a sample set. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loVal = sorted[lo];
  const hiVal = sorted[hi];
  if (loVal === undefined || hiVal === undefined) {
    return loVal ?? hiVal ?? Number.NaN;
  }
  return loVal + (hiVal - loVal) * (rank - lo);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function summarize(samples: readonly number[]) {
  return {
    n: samples.length,
    p50: round1(percentile(samples, 50)),
    p95: round1(percentile(samples, 95)),
    min: round1(Math.min(...samples)),
    max: round1(Math.max(...samples)),
    samples: samples.map(round1),
  };
}

function record(key: string, samples: readonly number[]): void {
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    store = {};
  }
  store[key] = summarize(samples);
  store.meta = { platform: process.platform, generatedAt: new Date().toISOString() };
  writeFileSync(RESULTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

/** Inject the live host connection, load the cockpit, await the real workspace list. */
async function connect(page: Page): Promise<void> {
  const conn = readConn();
  await page.addInitScript((value) => {
    (window as Window & { __GROVE_HOST__?: Conn }).__GROVE_HOST__ = value;
  }, conn);
  await page.goto("/");
  await page
    .getByTestId("workspace-rail")
    .getByText("feat/login-rework", { exact: true })
    .waitFor({ timeout: 30_000 });
}

/** Arm an in-page rAF poller that stamps `performance.now()` the moment the probe's
 *  condition becomes true. Paired with a `start` captured just before the action so
 *  the measured span is action -> visible. (~single-digit ms of Playwright/CDP
 *  dispatch is included and NOT subtracted — disclosed in the report.) */
async function armProbe(page: Page, probe: Probe): Promise<void> {
  await page.evaluate((p) => {
    window.__probe = { hit: null };
    const text = (sel: string): string => document.querySelector(sel)?.textContent ?? "";
    const done = (): boolean => {
      if (p.kind === "dialogOpen") {
        return Boolean(document.querySelector("dialog[open]"));
      }
      if (p.kind === "selectionChanged") {
        const c = text('[data-testid="workspace-rail"] [aria-current="true"]');
        return c !== "" && c !== p.from;
      }
      return text('[data-testid="terminal-stream"]').includes(p.marker);
    };
    const tick = (): void => {
      if (window.__probe && window.__probe.hit === null) {
        if (done()) {
          window.__probe.hit = performance.now();
          return;
        }
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, probe);
}

async function awaitProbe(page: Page, timeout: number): Promise<number> {
  await page.waitForFunction(() => window.__probe?.hit != null, undefined, { timeout });
  return page.evaluate(() => window.__probe?.hit ?? Number.NaN);
}

function selectedText(page: Page): Promise<string> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? "", SELECTED);
}

test.beforeAll(() => {
  writeFileSync(RESULTS_FILE, "{}", "utf8");
});

// Report-only: after every metric is recorded, print a single grep-able summary
// line (per-metric n/p50/p95/min/max) to stdout so the numbers land in the CI log,
// and copy the JSON to a stable repo-relative path for artifact upload. This adds
// NO budget assertions — PASS/OVER vs the §6.4 budgets stays an honest human read
// of the recorded numbers in evidence/phase-6/perf-report.md.
test.afterAll(() => {
  let store: Record<string, { n: number; p50: number; p95: number; min: number; max: number }> = {};
  try {
    store = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
  } catch {
    store = {};
  }
  const summary: Record<string, { n: number; p50: number; p95: number; min: number; max: number }> =
    {};
  for (const [key, value] of Object.entries(store)) {
    if (key === "meta" || value == null || typeof value !== "object") {
      continue;
    }
    const { n, p50, p95, min, max } = value;
    summary[key] = { n, p50, p95, min, max };
  }
  // Single-line, machine-grep-able marker (e.g. `rg '^PERF_RESULTS '` in the CI log).
  console.log(`PERF_RESULTS ${JSON.stringify({ platform: process.platform, metrics: summary })}`);
  // Human-friendly per-metric breakdown, also in the log.
  for (const [key, m] of Object.entries(summary)) {
    console.log(
      `PERF_METRIC ${key}: n=${m.n} p50=${m.p50}ms p95=${m.p95}ms (min=${m.min} max=${m.max})`,
    );
  }
  try {
    copyFileSync(RESULTS_FILE, UPLOAD_RESULTS_FILE);
    console.log(`PERF_RESULTS_FILE ${UPLOAD_RESULTS_FILE}`);
  } catch (err) {
    console.log(`PERF_RESULTS_FILE copy failed: ${(err as Error).message}`);
  }
});

test.describe.configure({ mode: "serial" });

test.describe("Phase-3 performance budgets (§6.4) — real host", () => {
  test("renderer cold start: navigation start -> live workspace list", async ({ browser }) => {
    const conn = readConn();
    const samples: number[] = [];
    const iterations = 10;
    for (let i = 0; i < iterations; i++) {
      // Fresh context per iteration = cold browser cache (true renderer cold start);
      // the vite-preview server is already warm, the realistic dev-host case.
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript((value) => {
        (window as Window & { __GROVE_HOST__?: Conn }).__GROVE_HOST__ = value;
      }, conn);
      await page.addInitScript(() => {
        const poll = (): void => {
          const rail = document.querySelector('[data-testid="workspace-rail"]');
          if (rail && (rail.textContent ?? "").includes("feat/login-rework")) {
            window.__coldMs = performance.now();
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      await page.goto("/");
      await page.waitForFunction(() => window.__coldMs !== undefined, undefined, {
        timeout: 30_000,
      });
      const cold = await page.evaluate(() => window.__coldMs ?? Number.NaN);
      samples.push(cold);
      await context.close();
    }
    record("coldStart", samples);
    expect(samples.length).toBe(iterations);
  });

  test("interaction latency: open Settings dialog (click -> visible)", async ({ page }) => {
    await connect(page);
    const button = page.getByRole("button", { name: "Keyboard shortcuts" });
    const samples: number[] = [];
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      await armProbe(page, { kind: "dialogOpen" });
      const start = await page.evaluate(() => performance.now());
      await button.click();
      const hit = await awaitProbe(page, 5_000);
      samples.push(hit - start);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"), undefined, {
        timeout: 5_000,
      });
      await page.waitForTimeout(120);
    }
    record("dialogOpen", samples);
    expect(samples.length).toBe(iterations);
  });

  test("interaction latency: switch workspace via keyboard (next)", async ({ page }) => {
    await connect(page);
    // Put keyboard focus in the page (the shell keymap listens at window capture).
    await page.getByTestId("app-titlebar").click();
    const samples: number[] = [];
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      const before = await selectedText(page);
      await armProbe(page, { kind: "selectionChanged", from: before });
      const start = await page.evaluate(() => performance.now());
      await page.keyboard.press("Control+Alt+ArrowDown");
      const hit = await awaitProbe(page, 5_000);
      samples.push(hit - start);
      await page.waitForTimeout(80);
    }
    record("workspaceSwitch", samples);
    expect(samples.length).toBe(iterations);
  });

  test("terminal-stream round-trip: send -> marker in xterm buffer", async ({ page }) => {
    await connect(page);
    // Use the git-backed worktree so the PTY spawns in a real on-disk cwd.
    await page.getByTestId("workspace-rail").getByText("chore/diff-demo", { exact: true }).click();
    await page.getByTestId("content-pane").getByText("chore/diff-demo").waitFor();

    // The host's interactive shell == this machine's platform (loopback). Build a
    // command whose OUTPUT contains the marker contiguously, while the TYPED text
    // does not (split across two literals) — so the PTY's input echo never
    // false-triggers detection and we time the true command -> output round-trip.
    const isWindows = process.platform === "win32";
    const buildSend = (marker: string): string => {
      const cut = Math.floor(marker.length / 2);
      const a = marker.slice(0, cut);
      const b = marker.slice(cut);
      return isWindows ? `'${a}'+'${b}'` : `printf '%s\\n' ${a}''${b}`;
    };

    const xterm = page.getByTestId("xterm-host").first();
    await xterm.click();

    // Warm up: prove the interactive shell is live and echoing before we time it
    // (PowerShell cold-starts slowly; that is a tab-open cost, not stream latency).
    for (let w = 0; w < 2; w++) {
      const marker = `GROVEWARM${w}Z`;
      await page.keyboard.type(buildSend(marker));
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (args) => (document.querySelector(args.sel)?.textContent ?? "").includes(args.mk),
        { sel: STREAM, mk: marker },
        { timeout: 30_000 },
      );
      await page.waitForTimeout(250);
    }

    const samples: number[] = [];
    const iterations = 25;
    for (let i = 0; i < iterations; i++) {
      const marker = `GROVEPERF${i}Z`;
      await page.keyboard.type(buildSend(marker));
      await armProbe(page, { kind: "streamContains", marker });
      const start = await page.evaluate(() => performance.now());
      await page.keyboard.press("Enter");
      const hit = await awaitProbe(page, 15_000);
      samples.push(hit - start);
      // Let the prompt return before the next send so inputs never interleave.
      await page.waitForTimeout(200);
    }
    record("terminalStream", samples);
    expect(samples.length).toBe(iterations);
  });
});
