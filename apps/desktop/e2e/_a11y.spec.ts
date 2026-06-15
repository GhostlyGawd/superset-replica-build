import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { CONN_FILE } from "./host-fixture.ts";

/**
 * Phase-3 accessibility audit (spec §6.2). A MEASUREMENT TOOL: it runs an automated
 * axe-core (MIT) audit against the real, connected renderer (main shell + the open
 * Settings dialog) and exercises the documented keyboard journeys, recording results
 * to JSON. The honest verdict is authored in `evidence/phase-3/a11y-report.md`.
 *
 * Keyboard checks are RECORDED (pass/fail), not hard-asserted, so a real gap is
 * reported rather than aborting the audit; the only hard assertion is that axe ran.
 */

interface Conn {
  readonly endpoint: string;
  readonly token: string;
}

interface AxeNodeRaw {
  readonly target: readonly unknown[];
  readonly html: string;
  readonly failureSummary?: string | null;
}
interface AxeRuleRaw {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly AxeNodeRaw[];
}
interface AxeResultsRaw {
  readonly violations: readonly AxeRuleRaw[];
  readonly passes: readonly { readonly id: string }[];
  readonly incomplete: readonly AxeRuleRaw[];
}

interface ViolationView {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly count: number;
  readonly targets: readonly string[];
}
interface AxeView {
  readonly violations: readonly ViolationView[];
  readonly incomplete: readonly ViolationView[];
  readonly passCount: number;
}

const nodeRequire = createRequire(import.meta.url);
const AXE_PATH = nodeRequire.resolve("axe-core");
const RESULTS_FILE = join(tmpdir(), "grove-a11y-results.json");

function readConn(): Conn {
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

function record(key: string, value: unknown): void {
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    store = {};
  }
  store[key] = value;
  store.meta = {
    platform: process.platform,
    axePath: AXE_PATH,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(RESULTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

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

/** Inject axe-core source and run it over the given context (or the whole doc). */
async function runAxe(page: Page, contextSelector: string | null): Promise<AxeView> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (selector) => {
    const api = (
      window as unknown as {
        axe: { run: (ctx: Document | Element, opts: object) => Promise<AxeResultsRaw> };
      }
    ).axe;
    const ctx: Document | Element =
      (selector ? document.querySelector(selector) : null) ?? document;
    const res = await api.run(ctx, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
    });
    const view = (rules: readonly AxeRuleRaw[]): ViolationView[] =>
      rules.map((r) => ({
        id: r.id,
        impact: r.impact,
        help: r.help,
        helpUrl: r.helpUrl,
        count: r.nodes.length,
        targets: r.nodes.slice(0, 6).map((n) => n.target.map((t) => String(t)).join(" ")),
      }));
    return {
      violations: view(res.violations),
      incomplete: view(res.incomplete),
      passCount: res.passes.length,
    };
  }, contextSelector);
}

function selectedText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector('[data-testid="workspace-rail"] [aria-current="true"]')?.textContent ??
      "",
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  writeFileSync(RESULTS_FILE, "{}", "utf8");
});

test.describe("Phase-3 accessibility audit (§6.2) — real host", () => {
  test("axe-core: connected main shell", async ({ page }) => {
    await connect(page);
    const result = await runAxe(page, null);
    record("shell", result);
    expect(result.passCount + result.violations.length).toBeGreaterThan(0);
  });

  test("axe-core: Settings dialog open", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await page.locator("dialog[open]").waitFor({ timeout: 5_000 });
    // Audit the populated dialog (bindings loaded), not the loading spinner.
    await page.getByTestId("settings-shortcuts").waitFor({ timeout: 10_000 });
    const scoped = await runAxe(page, "dialog[open]");
    const full = await runAxe(page, null);
    record("settingsDialog", { scoped, full });
    expect(scoped.passCount + scoped.violations.length).toBeGreaterThan(0);
  });

  test("keyboard navigation + dialog focus behavior", async ({ page }) => {
    await connect(page);
    const checks: Array<{ check: string; pass: boolean; detail?: string }> = [];
    const soft = async (name: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
        checks.push({ check: name, pass: true });
      } catch (err) {
        checks.push({
          check: name,
          pass: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    };
    const focusInsideDialog = (): Promise<boolean> =>
      page.evaluate(() => {
        const d = document.querySelector("dialog[open]");
        return Boolean(d && document.activeElement && d.contains(document.activeElement));
      });

    // Keyboard focus in the page; the shell keymap listens at window capture.
    await page.getByTestId("app-titlebar").click();

    await soft("workspace next (Ctrl+Alt+ArrowDown) changes selection", async () => {
      const before = await selectedText(page);
      await page.keyboard.press("Control+Alt+ArrowDown");
      await expect.poll(() => selectedText(page), { timeout: 3_000 }).not.toBe(before);
    });

    await soft("workspace prev (Ctrl+Alt+ArrowUp) changes selection", async () => {
      const before = await selectedText(page);
      await page.keyboard.press("Control+Alt+ArrowUp");
      await expect.poll(() => selectedText(page), { timeout: 3_000 }).not.toBe(before);
    });

    await soft("open Settings via Ctrl+Comma", async () => {
      await page.keyboard.press("Control+Comma");
      await page.locator("dialog[open]").waitFor({ timeout: 3_000 });
    });

    await soft("focus moves into dialog on open (trap entry)", async () => {
      if (!(await focusInsideDialog())) {
        throw new Error("activeElement not inside dialog after open");
      }
    });

    await soft("Tab keeps focus trapped inside dialog", async () => {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
      }
      if (!(await focusInsideDialog())) {
        throw new Error("focus escaped dialog during Tab cycle");
      }
    });

    await soft("Escape closes dialog", async () => {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"), undefined, {
        timeout: 3_000,
      });
    });

    await soft("open New-worktree via Ctrl+Alt+Shift+KeyN", async () => {
      await page.keyboard.press("Control+Alt+Shift+KeyN");
      await page.getByRole("dialog", { name: "New worktree" }).waitFor({ timeout: 3_000 });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"), undefined, {
        timeout: 3_000,
      });
    });

    await soft("open Open-project via Ctrl+Alt+KeyO", async () => {
      await page.keyboard.press("Control+Alt+KeyO");
      await page.getByRole("dialog", { name: "Open project" }).waitFor({ timeout: 3_000 });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[open]"), undefined, {
        timeout: 3_000,
      });
    });

    await soft("terminal preset slot Ctrl+1 runs and streams output", async () => {
      await page.getByTestId("xterm-host").first().click();
      await page.keyboard.press("Control+Digit1");
      await expect(page.getByTestId("terminal-stream")).toContainText("grove-terminal-online", {
        timeout: 20_000,
      });
    });

    record("keyboard", checks);
    expect(checks.length).toBeGreaterThan(0);
  });
});
