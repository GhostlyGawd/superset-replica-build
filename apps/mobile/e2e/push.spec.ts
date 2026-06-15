import { expect, test } from "@playwright/test";
import { pairAndLand } from "./pair-and-land.ts";

/**
 * W5 — the Web Push opt-in + in-app inbox (ADR-0014 decision 5). The seeded host
 * recorded a `needs_attention` notification on startup (its `/sync` demo transition),
 * so the inbox renders a REAL row that `markRead` flips. "Enable notifications" runs
 * the real opt-in: permission (granted via Playwright) → `pushManager.subscribe`
 * against the host VAPID key → `notifications.subscribePush`.
 *
 * NOTE: headless Chromium has no push service, so `subscribe` may reject — the app
 * surfaces that honestly. The REAL send path (subscribe → needs_attention →
 * web-push) is proven deterministically host-side in `notifications.test.ts`.
 */

test.describe("Grove PWA — W5 push opt-in + notifications inbox (phone viewport)", () => {
  test("shows the real notification inbox, marks it read, and runs the push opt-in", async ({
    page,
    context,
  }) => {
    // Pre-grant notification permission so the opt-in reaches the subscribe step.
    await context.grantPermissions(["notifications"]);

    await pairAndLand(page);
    await page.getByRole("button", { name: "Settings" }).click();

    // The push opt-in surface is present (real, gesture-driven).
    await expect(page.getByText("Push notifications", { exact: true })).toBeVisible();
    const enableButton = page.getByRole("button", { name: "Enable notifications" });
    await expect(enableButton).toBeVisible();

    // Real `notifications.list`: the host recorded a needs_attention row on startup.
    const inboxRow = page.getByText("fix/api-timeout needs your attention", { exact: true });
    await expect(inboxRow).toBeVisible({ timeout: 15_000 });

    // Real `notifications.markRead`: the unread row flips to read.
    await page.getByRole("button", { name: "Mark read" }).first().click();
    await expect(page.getByText("Read", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // The opt-in runs the real subscribe flow → either it turns on (a push-capable
    // browser) or it reports honestly that this browser can't enable push here.
    await enableButton.click();
    const turnedOn = page.getByText("This phone gets a push", { exact: false });
    const reportedHonestly = page.getByText(
      /Couldn't enable push|can't enable push here|permission was not granted|Notifications are blocked/i,
    );
    await expect(turnedOn.or(reportedHonestly)).toBeVisible({ timeout: 20_000 });
  });
});
