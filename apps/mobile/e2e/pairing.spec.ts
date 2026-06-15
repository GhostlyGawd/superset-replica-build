import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PAIR_FILE, type PairFixture } from "./host-fixture.ts";

function readPairFixture(): PairFixture {
  return JSON.parse(readFileSync(PAIR_FILE, "utf8")) as PairFixture;
}

test.describe("Grove PWA pairing → live host (phone viewport)", () => {
  test("redeems a single-use code and renders the real workspace list", async ({ page }) => {
    const { url, code } = readPairFixture();

    // Scanning the QR opens the PWA (served by the host) with the code pre-filled.
    await page.goto(`${url}/?code=${code}`);

    // The pairing screen mounts with the code auto-filled from the URL.
    await expect(page.getByRole("heading", { name: "Pair this phone" })).toBeVisible();
    await expect(page.getByLabel("Pairing code")).toHaveValue(code);

    // Redeem it — the public `pair.redeem` exchanges the code for the bearer, stored
    // in IndexedDB, and the app goes LIVE.
    await page.getByRole("button", { name: "Link this phone" }).click();

    // The real `workspaces.list` round-trip renders the seeded worktrees.
    await expect(page.getByText("feat/login-rework", { exact: true })).toBeVisible();
    await expect(page.getByText("fix/api-timeout", { exact: true })).toBeVisible();

    // The bottom nav is present once connected; Settings shows the live paired host.
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Paired host", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  });

  test("a fresh load with no stored pairing shows the pairing screen, not a crash", async ({
    browser,
  }) => {
    // A clean context (no IndexedDB) is unpaired: the honest pairing surface appears.
    const context = await browser.newContext();
    const page = await context.newPage();
    const { url } = readPairFixture();
    await page.goto(`${url}/`);
    await expect(page.getByRole("heading", { name: "Pair this phone" })).toBeVisible();
    await expect(page.getByText("Not paired", { exact: true })).toBeVisible();
    await context.close();
  });
});
