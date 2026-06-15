import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { CONN_FILE } from "./host-fixture.ts";

interface Conn {
  readonly endpoint: string;
  readonly token: string;
}

function readConn(): Conn {
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

/** Inject the live host connection, load the app, and select the git-backed worktree. */
async function openRealWorktree(page: import("@playwright/test").Page): Promise<void> {
  const conn = readConn();
  await page.addInitScript((value) => {
    (window as Window & { __GROVE_HOST__?: Conn }).__GROVE_HOST__ = value;
  }, conn);
  await page.goto("/");
  await page.getByTestId("workspace-rail").getByText("chore/diff-demo", { exact: true }).click();
  await expect(page.getByTestId("content-pane")).toContainText("chore/diff-demo");
}

test.describe("desktop content pane (P05 terminal + P06 diff) — real host", () => {
  test("opens a terminal and streams real output from the host PTY", async ({ page }) => {
    await openRealWorktree(page);

    // The Terminal tab is the default surface; run preset 1 (echo) which the host
    // spawns as a real, non-interactive shell command over the /terminal WS topic.
    await expect(page.getByRole("tab", { name: "Terminal" })).toBeVisible();
    await page.getByRole("button", { name: "Run preset 1: ping" }).click();

    // The streamed bytes from the real host PTY land in the active terminal.
    await expect(page.getByTestId("terminal-stream")).toContainText("grove-terminal-online", {
      timeout: 20_000,
    });

    await page.screenshot({ path: "../../evidence/phase-3/desktop-terminal.png" });
  });

  test("renders a real git diff and saves an inline edit back to the worktree", async ({
    page,
  }) => {
    await openRealWorktree(page);

    await page.getByRole("tab", { name: "Diff" }).click();

    // Real working-tree-vs-HEAD diff: the modified file + its changed line.
    const panel = page.getByTestId("diff-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("button", { name: /greeter\.ts/ })).toBeVisible();
    await expect(panel).toContainText("Hi,");

    // Inline edit → real save-back to the worktree via the diffs.writeFile mutation.
    // Scope to the diff panel: the content header now also carries an "Open in
    // editor" action (P08), so the bare-name button query must be panel-local.
    await panel.getByRole("button", { name: "Edit" }).click();
    const editor = page.getByTestId("diff-editor");
    await editor.fill("export function greet(name) {\n  return `Hey GROVE_SAVED_OK ${name}`;\n}\n");
    await panel.getByRole("button", { name: "Save" }).click();

    // The re-fetched diff (read back from disk) reflects the saved content.
    await expect(panel).toContainText("GROVE_SAVED_OK", { timeout: 15_000 });

    await page.screenshot({ path: "../../evidence/phase-3/desktop-diff.png" });
  });
});
