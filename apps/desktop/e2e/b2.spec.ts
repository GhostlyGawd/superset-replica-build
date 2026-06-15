import { existsSync, readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { CONN_FILE, EXTERNAL_CAPTURE_FILE } from "./host-fixture.ts";

interface Conn {
  readonly endpoint: string;
  readonly token: string;
}

interface CaptureEntry {
  readonly target: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly path: string;
}

function readConn(): Conn {
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

function readCapture(): CaptureEntry[] {
  if (!existsSync(EXTERNAL_CAPTURE_FILE)) {
    return [];
  }
  return readFileSync(EXTERNAL_CAPTURE_FILE, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CaptureEntry);
}

/** Inject the live host connection and load the connected cockpit. */
async function connect(page: Page): Promise<void> {
  const conn = readConn();
  await page.addInitScript((value) => {
    (window as Window & { __GROVE_HOST__?: Conn }).__GROVE_HOST__ = value;
  }, conn);
  await page.goto("/");
  await expect(
    page.getByTestId("workspace-rail").getByText("feat/login-rework", { exact: true }),
  ).toBeVisible();
}

test.describe("desktop wave B2 (P08 nav/open-external + P09 shortcuts/settings) — real host", () => {
  test("opens the selected worktree in an external editor/terminal/folder on the host", async ({
    page,
  }) => {
    await connect(page);
    // The first worktree is selected by default → the open-external toolbar is live.
    await expect(page.getByTestId("content-pane")).toContainText("feat/login-rework");

    for (const [label, target] of [
      ["Open in editor", "editor"],
      ["Open in terminal", "terminal"],
      ["Reveal in file manager", "folder"],
    ] as const) {
      await page.getByRole("button", { name: label }).click();
      // The host records the launch it WOULD perform (capture seam) — assert the
      // right target + that the recorded path is the selected worktree's.
      await expect
        .poll(() => readCapture().filter((entry) => entry.target === target).length)
        .toBeGreaterThan(0);
      const entry = readCapture().find((item) => item.target === target);
      expect(entry?.path).toMatch(/login/);
    }
  });

  test("navigates between worktrees with the keyboard (prev/next)", async ({ page }) => {
    await connect(page);
    const content = page.getByTestId("content-pane");
    await content.getByText("feat/login-rework").click();
    await expect(content).toContainText("feat/login-rework");

    await page.keyboard.press("Control+Alt+ArrowDown");
    await expect(content).toContainText("fix/api-timeout");

    await page.keyboard.press("Control+Alt+ArrowUp");
    await expect(content).toContainText("feat/login-rework");
  });

  test("creates a worktree via the New dialog and it appears in the rail", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "New worktree" }).click();

    const dialog = page.getByRole("dialog", { name: "New worktree" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("new-workspace-name").fill("feat/e2e-created");
    await dialog.getByRole("button", { name: "Create worktree" }).click();

    // A REAL git worktree is cut on the host; the rail refreshes to show it.
    await expect(
      page.getByTestId("workspace-rail").getByText("feat/e2e-created", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("customizes a keyboard shortcut in Settings and persists it across reload", async ({
    page,
  }) => {
    await connect(page);
    await expect(page.getByTestId("content-pane")).toContainText("feat/login-rework");

    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog.getByTestId("settings-shortcuts")).toBeVisible();

    const binding = dialog.getByTestId("binding-workspace.next");
    await expect(binding).toHaveText("Ctrl+Alt+↓");

    await dialog.getByRole("button", { name: "Rebind Next worktree" }).click();
    await expect(binding).toContainText("Press keys");
    await page.keyboard.press("Control+Alt+J");
    await expect(binding).toHaveText("Ctrl+Alt+J");

    await dialog.getByRole("button", { name: "Done" }).click();

    // Reload: the override is re-loaded from the host (real persistence).
    await page.reload();
    await expect(page.getByTestId("content-pane")).toContainText("feat/login-rework");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const reopened = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(reopened.getByTestId("binding-workspace.next")).toHaveText("Ctrl+Alt+J", {
      timeout: 10_000,
    });

    // Leave the host's settings clean for any later run.
    await reopened.getByRole("button", { name: "Reset all to defaults" }).click();
    await expect(reopened.getByTestId("binding-workspace.next")).toHaveText("Ctrl+Alt+↓");
  });
});
