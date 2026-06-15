import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PAIR_FILE, type PairFixture, mintPairCode } from "./host-fixture.ts";

function readPairFixture(): PairFixture {
  return JSON.parse(readFileSync(PAIR_FILE, "utf8")) as PairFixture;
}

/**
 * Pair the phone against the real seeded host and land on the live worktree list.
 * Each test mints its OWN fresh single-use code (codes are single-use, so tests must
 * not share one) — the browser still only receives the bearer via `pair.redeem`.
 */
async function pairAndLand(page: import("@playwright/test").Page): Promise<void> {
  const { url, token } = readPairFixture();
  const code = await mintPairCode(url, token);
  await page.goto(`${url}/?code=${code}`);
  await expect(page.getByRole("heading", { name: "Pair this phone" })).toBeVisible();
  await page.getByRole("button", { name: "Link this phone" }).click();
  // The real `workspaces.list` round-trip renders the seeded worktrees, incl. the
  // git-backed one the read journeys attach to.
  await expect(page.getByText("diff-demo", { exact: true })).toBeVisible();
}

test.describe("Grove PWA — W3 read journeys (phone viewport, real host)", () => {
  test("workspace detail shows the real branch, git status, and the live agent", async ({
    page,
  }) => {
    await pairAndLand(page);

    // Tap the git-backed worktree row → its detail sheet opens.
    await page.getByRole("button", { name: /diff-demo/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Real `workspaces.gitStatus`: the branch + an ahead/behind read vs the base.
    await expect(sheet.getByText("feat/diff-demo").first()).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText("In sync with main")).toBeVisible({ timeout: 15_000 });

    // Real `sessions.list`: the running agent in this worktree, with live status.
    await expect(sheet.getByText("claude-code").first()).toBeVisible();
    await expect(sheet.getByText("Running agents")).toBeVisible();
  });

  test("the Agents tab rolls up the live cross-workspace agent and taps through", async ({
    page,
  }) => {
    await pairAndLand(page);

    await page.getByRole("button", { name: "Agents" }).click();

    // One real session across the host → the live count + the agent row.
    await expect(page.getByText("1 running · 1 total")).toBeVisible({ timeout: 15_000 });
    const agentRow = page.getByRole("button", { name: /diff-demo/ });
    await expect(agentRow).toBeVisible();
    await expect(page.getByText("claude-code")).toBeVisible();

    // Tapping the agent opens its worktree's detail.
    await agentRow.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("In sync with main")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("the Diff tab renders a real read-only file diff for the picked worktree", async ({
    page,
  }) => {
    await pairAndLand(page);

    await page.getByRole("button", { name: "Diff", exact: true }).click();

    // Pick the git-backed worktree (requirement: pick a workspace → diff review).
    await page.getByLabel("Worktree").selectOption({ label: "diff-demo · feat/diff-demo" });

    // Real `diffs.status`: the changed file with +/- counts.
    const fileRow = page.getByRole("button", { name: /greeter\.ts/ });
    await expect(fileRow).toBeVisible({ timeout: 15_000 });

    // Tap it → real `diffs.getFileDiff` hunks render in the shared DiffView.
    await fileRow.click();
    await expect(page.getByText(/Hi,/).first()).toBeVisible({ timeout: 15_000 });

    // Read-only on the phone: no inline-edit affordance is offered.
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await page.screenshot({ path: "../../evidence/phase-4/mobile-diff.png" });
  });
});
