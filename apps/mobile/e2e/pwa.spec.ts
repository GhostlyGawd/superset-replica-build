import { expect, test } from "@playwright/test";
import { BASE_URL } from "./host-fixture.ts";

/**
 * W5 — the offline service worker + installability (ADR-0014 decision 6). The host
 * serves the real built PWA at `http://127.0.0.1` — a SECURE CONTEXT — so the SW
 * registers for real and the app-shell is cached. These assert the SW controls the
 * page, the shell loads OFFLINE, and the manifest is installable.
 */

test.describe("Grove PWA — W5 service worker + installability (phone viewport)", () => {
  test("registers the service worker and serves the app-shell offline", async ({
    page,
    context,
  }) => {
    await page.goto(`${BASE_URL}/`);

    // The custom injectManifest SW activates and claims the page (secure context).
    const sw = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        hasActive: registration.active !== null,
        scriptURL: registration.active?.scriptURL ?? "",
      };
    });
    expect(sw.hasActive).toBe(true);
    expect(sw.scriptURL).toContain("/sw.js");

    // `clients.claim()` takes control of the open page (so a real first visit is
    // SW-controlled without a reload).
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        timeout: 10_000,
      })
      .toBe(true);

    // Go offline and reload: the app-shell is served from the precache, so the React
    // app still boots (it lands on the honest pairing screen — no host reachable).
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Pair this phone" })).toBeVisible({
      timeout: 15_000,
    });
    await context.setOffline(false);
  });

  test("links a valid, installable web app manifest (standalone + maskable icons)", async ({
    page,
    request,
  }) => {
    await page.goto(`${BASE_URL}/`);

    // The manifest is linked from the document head.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );

    // ...and is a valid, installable manifest: standalone display, a start_url, and
    // both regular + maskable icons (incl. a 512px icon).
    const response = await request.get(`${BASE_URL}/manifest.webmanifest`);
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as {
      display?: string;
      start_url?: string;
      icons?: Array<{ sizes?: string; purpose?: string }>;
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    const icons = manifest.icons ?? [];
    expect(icons.some((i) => i.sizes === "512x512")).toBe(true);
    expect(icons.some((i) => (i.purpose ?? "").includes("maskable"))).toBe(true);
  });
});
