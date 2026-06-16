import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

/**
 * Accessibility audit for the Grove launch site (DESIGN.md §Verification: axe 0
 * critical/serious). Injects axe-core (MIT) and runs it over the prerendered page
 * AND the open command palette, at BOTH the desktop and Pixel-5 phone projects.
 * Unlike the desktop/mobile audits there is no host — the landing page talks to
 * nothing — so this runs against the static output directly.
 *
 * The HARD GATE here is the spec's own contract: ZERO critical and ZERO serious
 * violations. Results are also recorded to JSON so `evidence/site/a11y.md` can
 * cite the rule set + surfaces + counts honestly.
 */

interface AxeNodeRaw {
  readonly target: readonly unknown[];
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
const RESULTS_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../evidence/site/a11y-results.json",
);

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

function record(key: string, value: unknown): void {
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(readFileSync(RESULTS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    store = {};
  }
  store[key] = value;
  store.meta = { axePath: AXE_PATH, tags: TAGS, generatedAt: new Date().toISOString() };
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, JSON.stringify(store, null, 2), "utf8");
}

/** Inject axe-core and run it over the given context (or the whole document). */
async function runAxe(page: Page, contextSelector: string | null): Promise<AxeView> {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(
    async ({ selector, tags }) => {
      const api = (
        window as unknown as {
          axe: { run: (ctx: Document | Element, opts: object) => Promise<AxeResultsRaw> };
        }
      ).axe;
      const ctx: Document | Element =
        (selector ? document.querySelector(selector) : null) ?? document;
      const res = await api.run(ctx, { runOnly: { type: "tag", values: tags } });
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
    },
    { selector: contextSelector, tags: TAGS },
  );
}

/** The gate: ZERO critical, ZERO serious. Lesser impacts are reported, not failed. */
function expectNoSeriousOrCritical(view: AxeView, label: string): void {
  const blocking = view.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(
    blocking,
    `${label}: ${blocking.length} critical/serious axe violation(s): ${JSON.stringify(
      blocking,
      null,
      2,
    )}`,
  ).toHaveLength(0);
}

test.describe("Grove launch site — axe accessibility (0 critical/serious)", () => {
  test("page at rest", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Run a swarm of coding agents. Keep one calm surface." }),
    ).toBeVisible();
    const result = await runAxe(page, null);
    record(`${testInfo.project.name}.page`, result);
    expect(result.passCount).toBeGreaterThan(0);
    expectNoSeriousOrCritical(result, `${testInfo.project.name} page`);
  });

  test("command palette open", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open command palette" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    // Audit the whole document with the dialog open (so the trap + overlay count),
    // and the scoped dialog subtree.
    const full = await runAxe(page, null);
    const scoped = await runAxe(page, "dialog[open]");
    record(`${testInfo.project.name}.palette`, { full, scoped });
    expectNoSeriousOrCritical(full, `${testInfo.project.name} palette (full)`);
    expectNoSeriousOrCritical(scoped, `${testInfo.project.name} palette (scoped)`);
  });
});
