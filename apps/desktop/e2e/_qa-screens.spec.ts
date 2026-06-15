import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { CONN_FILE } from "./host-fixture.ts";

/**
 * QA screenshot capture for the Phase-3 wave-B2 surfaces (design Critic evidence).
 * NOT a product spec: it asserts nothing, it only drives each real surface to a
 * settled, intentional frame and writes a PNG. Reuses the live-host global-setup
 * (real tRPC + sync, no mocks) like the product specs do.
 */

interface Conn {
  readonly endpoint: string;
  readonly token: string;
}

/** Repo-root evidence dir, resolved from this file so cwd doesn't matter. */
const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../evidence/phase-3");
const shot = (name: string) => join(EVIDENCE_DIR, `${name}.png`);

function readConn(): Conn {
  return JSON.parse(readFileSync(CONN_FILE, "utf8")) as Conn;
}

/** Inject the live host connection, load the cockpit, and wait for the real
 *  workspace list + a selected worktree (so no frame is captured mid-load). */
async function connect(page: Page): Promise<void> {
  const conn = readConn();
  await page.addInitScript((value) => {
    (window as Window & { __GROVE_HOST__?: Conn }).__GROVE_HOST__ = value;
  }, conn);
  await page.goto("/");
  await expect(
    page.getByTestId("workspace-rail").getByText("feat/login-rework", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("content-pane")).toContainText("feat/login-rework");
  // Let the rail status dots + content header settle before the shutter.
  await page.waitForTimeout(400);
}

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

test.describe("QA screens — Phase-3 wave-B2 (real host)", () => {
  test("01 workspace nav — shell with rail + content header", async ({ page }) => {
    await connect(page);
    await page.screenshot({ path: shot("b2-workspace-nav") });
  });

  test("02 new-workspace dialog", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "New worktree" }).click();
    const dialog = page.getByRole("dialog", { name: "New worktree" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("new-workspace-name")).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot("b2-new-workspace-dialog") });
  });

  test("03 open-project dialog", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "Open project" }).click();
    const dialog = page.getByRole("dialog", { name: "Open project" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("open-project-path")).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot("b2-open-project-dialog") });
  });

  test("04 open-external controls in content header", async ({ page }) => {
    await connect(page);
    // The editor/terminal/folder open-in-external controls live in the content
    // header; hover the first to surface its tooltip so the control group reads
    // as intentional rather than incidental chrome.
    const editorBtn = page.getByRole("button", { name: "Open in editor" });
    await expect(editorBtn).toBeVisible();
    await editorBtn.hover();
    await expect(page.getByText("Open in editor", { exact: true }).last()).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot("b2-open-external-menu") });
  });

  test("05 settings — customizable keyboard shortcuts", async ({ page }) => {
    await connect(page);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog.getByTestId("settings-shortcuts")).toBeVisible();
    // Wait for the real binding values to load (not the loading spinner).
    await expect(dialog.getByTestId("binding-workspace.next")).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: shot("b2-settings-shortcuts") });
  });

  test("06 phone-width responsive shell", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await connect(page);
    await page.screenshot({ path: shot("b2-phone-width") });
  });
});
