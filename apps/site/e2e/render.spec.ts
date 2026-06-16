import { expect, test } from "@playwright/test";

/**
 * Render proof (DESIGN.md §Verification): the cockpit shell + every section's key
 * real copy/elements are present, at BOTH a desktop viewport and a Pixel-5 phone
 * viewport (the two Playwright projects in playwright.config.ts). The copy is
 * prerendered into the static HTML, so these assertions also prove the no-JS /
 * unfurl / SEO payload is real — not a blank SPA shell.
 *
 * Some chrome is responsive (the worktree rail is `lg:`, the centered tally is
 * `md:`); those are asserted only on the desktop project. Everything checked on
 * both projects is content that ships at every width.
 */

const isPhone = (projectName: string) => projectName === "phone";

test.describe("Grove launch site renders", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("persistent cockpit shell chrome", async ({ page }, testInfo) => {
    // Identity (top status rail) — present at every width.
    await expect(page.getByText("grove", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("v1.0.0")).toBeVisible();

    // Command-palette affordance + theme toggle live in the rail at all widths.
    await expect(page.getByRole("button", { name: "Open command palette" })).toBeVisible();
    await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();

    // Bottom status strip — the honest host line + the swarm clock.
    await expect(
      page.getByText("grove · loopback:7433 · bearer · embedded postgres · 0 outbound"),
    ).toBeVisible();
    await expect(page.getByLabel("Swarm clock")).toBeVisible();

    if (!isPhone(testInfo.project.name)) {
      // The left worktree rail (lg+) and the centered swarm tally (md+).
      await expect(page.getByRole("navigation", { name: "Worktrees" })).toBeVisible();
      await expect(page.getByText("14 agents", { exact: false })).toBeVisible();
    }
  });

  test("00 cold open — the one headline + roster", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Run a swarm of coding agents. Keep one calm surface." }),
    ).toBeVisible();
    // The primary install CTA + the docs ghost.
    await expect(page.getByRole("button", { name: /grove up/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the docs" })).toBeVisible();
    // The dense roster Table real content, scoped to the section (the left rail —
    // hidden on phone — also lists the branch). The roster grid is scrollable; the
    // cell exists even if scrolled, so assert presence within the section.
    await expect(page.locator("#cold-open").getByText("fix/auth-flow").first()).toHaveCount(1);
    await expect(page.locator("#cold-open").getByText("Claude Code").first()).toBeVisible();
  });

  test("01 swarm dial — the signature stepper", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "The swarm dial" })).toBeVisible();
    await expect(page.getByRole("slider", { name: /number of agents/i })).toBeVisible();
    // The dial caption recomputes from the same number (tabular figures).
    await expect(page.getByText(/one trunk · order steady · 0 reflows/)).toBeVisible();
  });

  test("02 isolation — segmented toggle + diff + fork", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Every agent on its own worktree" }),
    ).toBeVisible();
    // The segmented control with both real, text-labelled modes (the radios are
    // sr-only by design; assert the visible labels carry the meaning). `exact`
    // so the label doesn't collide with the same words in the subhead.
    await expect(page.getByText("per-worktree (Grove)", { exact: true })).toBeVisible();
    await expect(page.getByText("shared checkout", { exact: true })).toBeVisible();
    // The default (Grove) status + the fork diagram.
    await expect(page.getByText("isolated", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "One trunk forking into four isolated worktrees, one per agent",
      }),
    ).toBeVisible();
  });

  test("02 isolation — toggle flips to collision risk (click state-change)", async ({ page }) => {
    // Click the visible segment label (it wraps the sr-only radio).
    await page.getByText("shared checkout", { exact: true }).click();
    await expect(page.getByText("collision risk", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Four agents all branching onto a single shared checkout" }),
    ).toBeVisible();
  });

  test("03 terminal — per-agent tabs, distinct recorded sessions", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "The terminal, streamed" })).toBeVisible();
    // Three distinct agent tabs.
    await expect(page.getByRole("button", { name: "claude · auth-flow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "claude · pty-backpressure" })).toBeVisible();
    await expect(page.getByRole("button", { name: "codex · ports" })).toBeVisible();
    // Honest label + the default agent's distinct output (the paused auth run).
    await expect(page.getByText("recorded session").first()).toBeVisible();
    await expect(page.getByText(/agent paused — waiting on your input/)).toBeVisible();

    // Switching to a different agent shows THAT agent's distinct output.
    await page.getByRole("button", { name: "codex · ports" }).click();
    await expect(page.getByText(/port 9229 conflicts with the debugger/)).toBeVisible();
    await expect(page.getByText("Compiling port-scanner v0.3.1")).toBeVisible();
    // And the auth-run output is gone (it was a different session, not shared).
    await expect(page.getByText(/agent paused — waiting on your input/)).toHaveCount(0);
  });

  test("04 harvest — cross-surface diff review", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /harvest/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /harvest → main/i })).toBeVisible();
  });

  test("05 monitoring — status legend board", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /monitoring/i })).toBeVisible();
    // The IconButton (exact accessible name) — the section also has a text link
    // "simulate a notification →", so disambiguate to the labelled control.
    await expect(
      page.getByRole("button", { name: "Simulate a notification", exact: true }),
    ).toBeVisible();
  });

  test("06 phone pairing — labeled sample QR", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /phone/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^pair/i }).first()).toBeVisible();
  });

  test("07 install — OS tabs + commands + honest cost", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /install/i }).first()).toBeVisible();
    // The closing honest line + the OSS/MIT cost badge.
    await expect(page.getByText(/Nothing leaves your machine/i).first()).toBeVisible();
    await expect(page.getByText("OSS · MIT").first()).toBeVisible();
  });

  test("command palette opens and lists real product verbs", async ({ page }) => {
    await page.getByRole("button", { name: "Open command palette" }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    // Real CLI verbs, mapped to panes.
    for (const verb of ["up", "ls", "diff", "status", "harvest", "pair", "kill"]) {
      await expect(dialog.getByRole("option", { name: new RegExp(`^${verb}\\b`) })).toBeVisible();
    }
  });
});
