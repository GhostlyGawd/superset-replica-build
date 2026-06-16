import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

/**
 * Evidence screenshots (DESIGN.md §Verification: "Playwright screenshots — it
 * actually renders"). NOT a behavioural gate: it drives the cockpit to settled,
 * intentional frames and writes PNGs under evidence/site/. Captured at the
 * desktop project (full page + the SWARM DIAL mid-interaction) and re-used at the
 * Pixel-5 project for the phone-width capture.
 */

const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../evidence/site");
const shot = (name: string) => join(EVIDENCE_DIR, `${name}.png`);

async function settle(page: Page): Promise<void> {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Run a swarm of coding agents. Keep one calm surface." }),
  ).toBeVisible();
  // Let fonts + the prerendered hydration settle before the shutter.
  await page.waitForTimeout(350);
}

test.describe("Grove launch site — evidence captures", () => {
  test("cockpit at rest — full page", async ({ page }, testInfo) => {
    await settle(page);
    await page.screenshot({
      path: shot(`cockpit-${testInfo.project.name}-full`),
      fullPage: true,
    });
  });

  test("cockpit top — shell chrome above the fold", async ({ page }, testInfo) => {
    await settle(page);
    await page.screenshot({ path: shot(`cockpit-${testInfo.project.name}-top`) });
  });

  test("swarm dial mid-interaction (cranked)", async ({ page }, testInfo) => {
    // Skip on phone: the dial section reads the same, but the signature shot is
    // the desktop grid filled out.
    test.skip(testInfo.project.name === "phone", "signature dial capture is desktop");
    await settle(page);
    const dial = page.getByRole("slider", { name: /number of agents/i });
    await dial.scrollIntoViewIfNeeded();
    await dial.focus();
    // Crank the dial by hand (a PULL) so the grid populates — the signature.
    await dial.fill("64");
    await expect(page.getByText(/64 agents · 64 worktrees/)).toBeVisible();
    await page.waitForTimeout(300);
    await page.locator("#swarm-dial").screenshot({ path: shot("swarm-dial-cranked") });
  });
});
