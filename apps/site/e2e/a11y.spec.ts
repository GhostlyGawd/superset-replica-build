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
 * `violations`, AND zero serious/critical `incomplete` items except a small,
 * documented allowlist of human-verified false-positives (see
 * INCOMPLETE_FALSE_POSITIVES below). Results are also recorded to JSON so
 * `evidence/site/a11y.md` can cite the rule set + surfaces + counts honestly.
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
          // ALL node targets (not a slice): the incomplete waiver below inspects
          // every target, so an unshown node can never slip past a documented
          // false-positive allowlist.
          targets: r.nodes.map((n) => n.target.map((t) => String(t)).join(" ")),
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

const isBlocking = (v: ViolationView): boolean => v.impact === "critical" || v.impact === "serious";

/**
 * Documented, verified false-positives in axe's `incomplete` bucket — items axe
 * cannot statically resolve but which a human (the §6.3 Critic) confirmed pass.
 * Each entry pins a rule id AND a target-selector substring so a NEW
 * serious/critical incomplete on a different element still fails the gate; only
 * these exact, justified cases are waived. An incomplete is waived only when its
 * id matches and EVERY one of its reported targets matches an allowed selector.
 */
const INCOMPLETE_FALSE_POSITIVES: readonly {
  readonly id: string;
  readonly selector: string;
  readonly why: string;
}[] = [
  {
    // Focusable scroll regions (`@swarm/ui` DiffView/TerminalFrame/CodeBlock <pre>
    // + the ColdOpen roster wrapper) carry `aria-label` + `tabindex=0` so a
    // keyboard user can scroll them (the prior `scrollable-region-focusable`
    // fix). axe can't statically decide if aria-label is prohibited on a
    // focusable generic element; the accessible name on a scroll container is
    // correct and intentional. Verified OK.
    id: "aria-prohibited-attr",
    selector: 'aria-label="Agent roster, scrollable"',
    why: "focusable scroll region (roster) — accessible name is intentional",
  },
  {
    id: "aria-prohibited-attr",
    selector: 'aria-label="Terminal output"',
    why: "focusable scroll region (terminal)",
  },
  {
    id: "aria-prohibited-attr",
    selector: 'aria-label="Diff:',
    why: "focusable scroll region (diff body)",
  },
  {
    id: "aria-prohibited-attr",
    selector: 'aria-label="Code:',
    why: "focusable scroll region (code block)",
  },
  {
    // The command-palette focus ring's offset colour against the overlay scrim:
    // only ever rendered transiently while an item has keyboard focus, and the
    // ring itself is a decorative offset, not text. Verified clears AA in use.
    id: "color-contrast",
    selector: "ring-offset-overlay",
    why: "transient focus-ring offset over the palette scrim — decorative, not text",
  },
  {
    // Diff syntax glyphs sit on a tinted `bg-diff-add-bg` add-row at the phone
    // width; axe can't compute the layered token-on-tint contrast. Critic
    // verified the diff foreground clears AA on the add background.
    id: "color-contrast",
    selector: "bg-diff-add-bg",
    why: "diff token over tinted add-row — layered bg axe can't compute; verified AA",
  },
  {
    // The Isolation `ForkVisual` <text> labels (agent names / "one checkout").
    // axe cannot compute contrast for SVG `fill` colours, so it reports them
    // `incomplete` rather than passing — even though they are marked
    // aria-hidden (decorative; the <svg role="img"> carries the accessible
    // name). aria-hidden removes them from the a11y tree but axe still runs the
    // visual contrast check on rendered text, hence the residual incomplete.
    // §6.3 Critic measured these at ~5.2–6.3:1 against the panel inset — clears
    // AA. The text stays visually present by design.
    id: "color-contrast",
    selector: "text[",
    why: "SVG <text> fill contrast — axe can't compute SVG fills; Critic verified AA 5.2–6.3:1",
  },
  {
    // The RecordedTerminal prompt glyph `❯` (the one sanctioned leaf-green
    // accent) over the terminal inset. axe can't compute the layered
    // terminal-cell contrast and reports it incomplete; it is the single accent
    // token on a dark inset and clears AA in practice. Pre-existing accepted
    // incomplete, carried forward explicitly under the hardened gate.
    id: "color-contrast",
    selector: "text-accent-fg",
    why: "terminal prompt accent glyph over dark inset — axe can't compute; verified AA",
  },
];

/** True when this incomplete item is a fully-documented, verified false-positive. */
function isWaivedIncomplete(v: ViolationView): boolean {
  const allowed = INCOMPLETE_FALSE_POSITIVES.filter((e) => e.id === v.id);
  if (allowed.length === 0) return false;
  // Every reported target must be covered by an allowed selector; an unexpected
  // target (a real new regression) is therefore NOT waived.
  return v.targets.every((t) => allowed.some((e) => t.includes(e.selector)));
}

/**
 * The gate: ZERO critical, ZERO serious `violations`, AND zero serious/critical
 * `incomplete` items (after subtracting the documented false-positives above).
 * Lesser impacts are reported, not failed.
 */
function expectNoSeriousOrCritical(view: AxeView, label: string): void {
  const blocking = view.violations.filter(isBlocking);
  expect(
    blocking,
    `${label}: ${blocking.length} critical/serious axe violation(s): ${JSON.stringify(
      blocking,
      null,
      2,
    )}`,
  ).toHaveLength(0);

  const blockingIncomplete = view.incomplete
    .filter(isBlocking)
    .filter((v) => !isWaivedIncomplete(v));
  expect(
    blockingIncomplete,
    `${label}: ${blockingIncomplete.length} unwaived critical/serious axe INCOMPLETE item(s) ` +
      `(real false-positives must be added to INCOMPLETE_FALSE_POSITIVES with a selector + reason): ${JSON.stringify(
        blockingIncomplete,
        null,
        2,
      )}`,
  ).toHaveLength(0);
}

test.describe("Grove launch site — axe accessibility (0 critical/serious)", () => {
  test("page at rest", async ({ page }, testInfo) => {
    await page.goto("./");
    await expect(
      page.getByRole("heading", { name: "Run a swarm of coding agents. Keep one calm surface." }),
    ).toBeVisible();
    const result = await runAxe(page, null);
    record(`${testInfo.project.name}.page`, result);
    expect(result.passCount).toBeGreaterThan(0);
    expectNoSeriousOrCritical(result, `${testInfo.project.name} page`);
  });

  test("command palette open", async ({ page }, testInfo) => {
    await page.goto("./");
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
