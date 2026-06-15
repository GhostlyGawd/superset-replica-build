import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, devices, expect, test } from "@playwright/test";
import { BASE_URL, mintPairCode } from "./host-fixture.ts";
import { readPairFixture } from "./pair-and-land.ts";
import { type CaddyTlsProxy, startCaddyTlsProxy } from "./secure-context-proxy.ts";

/**
 * SECURE-CONTEXT PROOF — closes ADR-0014 decision 4 (Phase-5 W5, ADR-0017).
 *
 * The PWA's service worker + `pushManager.subscribe` only work over a SECURE CONTEXT
 * (HTTPS or localhost). Phase 4 proved them at the `http://127.0.0.1` localhost origin;
 * this proves them over a real HTTPS origin — the on-device-equivalent of the
 * cloudflared tunnel's HTTPS edge. A local Caddy reverse-proxy terminates self-signed
 * TLS (`tls internal`) in front of the REAL seeded host (started in globalSetup), so
 * the PWA loads from `https://localhost:<port>`. We then assert, end to end:
 *   1. `navigator.serviceWorker` registers AND controls the page over HTTPS.
 *   2. The phone pairs over HTTPS (real tRPC through the TLS proxy).
 *   3. The in-app opt-in runs the REAL Web Push flow — `notifications.vapidPublicKey`
 *      → `pushManager.subscribe({ applicationServerKey })` RESOLVES with a genuine
 *      `fcm.googleapis.com` subscription → `notifications.subscribePush` stores it —
 *      reaching the honest "On" state (which the UI shows ONLY after subscribePush
 *      succeeds).
 *
 * WHY THIS IS A LOCAL-EVIDENCE SPEC (not CI-gated): a real Web Push subscription needs
 * a browser with Google's FCM keys — i.e. branded **Google Chrome** (`channel:
 * "chrome"`), not the open-source Chromium bundled with Playwright (which answers
 * "push service not available"), and a non-incognito PERSISTENT context (Chrome
 * disables the Push API in incognito). The SW script load over Caddy's self-signed
 * cert further needs the global `--ignore-certificate-errors` launch flag (Playwright's
 * per-context `ignoreHTTPSErrors` does NOT cover the SW script fetch). None of that is
 * reproducible on a headless CI runner, and the cold FCM handshake is not deterministic
 * enough to gate CI — so per ADR-0017 this runs LOCALLY and its recorded result under
 * `evidence/phase-5/` is the proof. It is an `_*.spec.ts` measurement spec, excluded
 * from the default e2e run unless `GROVE_E2E_MEASURE=1`, so CI never executes it.
 *
 * Run: `GROVE_E2E_MEASURE=1 node ./node_modules/@playwright/test/cli.js test _secure-context.spec.ts`
 */

const MOBILE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCE_DIR = join(MOBILE_ROOT, "..", "..", "evidence", "phase-5");
const pixel = devices["Pixel 5"];

let proxy: CaddyTlsProxy;

test.beforeAll(async () => {
  proxy = await startCaddyTlsProxy(BASE_URL);
});

test.afterAll(async () => {
  await proxy?.stop();
});

test.describe("Grove PWA — secure-context proof (Caddy TLS · SW + Web Push over HTTPS)", () => {
  test("registers the SW and resolves a real push subscription over HTTPS", async () => {
    // The cold FCM/MCS handshake the real subscription performs can take ~60–90s.
    test.setTimeout(240_000);

    const userDataDir = mkdtempSync(join(tmpdir(), "grove-secure-ctx-"));
    // channel "chrome" → branded Chrome (has FCM keys); persistent context →
    // non-incognito (Push API enabled); --ignore-certificate-errors → the SW script
    // loads over Caddy's self-signed TLS cert.
    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: true,
      args: ["--ignore-certificate-errors"],
      ignoreHTTPSErrors: true,
      viewport: pixel.viewport,
      userAgent: pixel.userAgent,
      deviceScaleFactor: pixel.deviceScaleFactor,
      isMobile: pixel.isMobile,
      hasTouch: pixel.hasTouch,
    });
    await context.grantPermissions(["notifications"], { origin: proxy.httpsUrl });

    const result: Record<string, unknown> = { origin: proxy.httpsUrl };
    try {
      const page = await context.newPage();

      // (1) SW registers + controls the page over the HTTPS origin.
      await page.goto(`${proxy.httpsUrl}/`, { waitUntil: "load" });
      const sw = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return { active: reg.active !== null, scriptURL: reg.active?.scriptURL ?? "" };
      });
      expect(sw.active, "service worker has an active registration").toBe(true);
      expect(sw.scriptURL, "active SW is /sw.js over HTTPS").toContain("/sw.js");
      expect(sw.scriptURL.startsWith("https://"), "SW served from a secure HTTPS origin").toBe(
        true,
      );
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
          timeout: 15_000,
        })
        .toBe(true);
      result.swRegistered = true;
      result.swScriptURL = sw.scriptURL;
      result.swControlsPage = true;

      // (2) Pair over HTTPS — a real single-use code redeemed through the TLS proxy.
      const { token } = readPairFixture();
      const code = await mintPairCode(BASE_URL, token);
      await page.goto(`${proxy.httpsUrl}/?code=${code}`, { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Pair this phone" })).toBeVisible();
      await page.getByRole("button", { name: "Link this phone" }).click();
      await expect(page.getByText("diff-demo", { exact: true })).toBeVisible({ timeout: 20_000 });
      result.pairedOverHttps = true;

      // (3) The REAL Web Push opt-in: vapidPublicKey → pushManager.subscribe (resolves
      // with a genuine FCM subscription) → notifications.subscribePush. The card flips
      // to "On" ONLY after subscribePush succeeds, so that state is the end-to-end proof.
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByText("Push notifications", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Enable notifications" }).click();
      await expect(page.getByText("This phone gets a push", { exact: false })).toBeVisible({
        timeout: 180_000,
      });
      result.pushSubscribed = true;
      result.subscribePushStored = true;

      // Capture the genuine subscription the browser obtained (for the evidence file).
      const sub = (await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        const s = await reg.pushManager.getSubscription();
        return s ? s.toJSON() : null;
      })) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
      expect(sub, "a push subscription exists after opt-in").not.toBeNull();
      const endpoint = sub?.endpoint ?? "";
      expect(
        endpoint.startsWith("https://"),
        "subscription endpoint is a secure HTTPS push URL",
      ).toBe(true);
      expect(
        Boolean(sub?.keys?.p256dh && sub?.keys?.auth),
        "subscription carries p256dh + auth keys",
      ).toBe(true);
      result.subscriptionEndpoint = endpoint;
      result.subscriptionHasKeys = Boolean(sub?.keys?.p256dh && sub?.keys?.auth);

      // Evidence: screenshot of the live "On" state + a recorded markdown report.
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: join(EVIDENCE_DIR, "secure-context.png"), fullPage: true });
      writeEvidence(result);
    } finally {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});

/** Write the human-readable proof to evidence/phase-5/secure-context.md. */
function writeEvidence(r: Record<string, unknown>): void {
  const endpoint = String(r.subscriptionEndpoint ?? "");
  const host = (() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return "(unknown)";
    }
  })();
  const md = `# Phase-5 W5 — Secure-context proof (SW install + Web Push over HTTPS)

_Closes ADR-0014 decision 4 (the LAN/remote secure-context deferral); ADR-0017 local
evidence split._ Generated by \`apps/mobile/e2e/_secure-context.spec.ts\` on a real run.

## What was proven
A **Caddy reverse-proxy with \`tls internal\` (self-signed)** terminated HTTPS in front of
the REAL seeded Grove host (the same host the phone-viewport e2e boots), so the PWA loaded
from a genuine **secure-context HTTPS origin** — \`${r.origin}\` — exactly as it would behind
the cloudflared tunnel's trusted edge. Over that origin:

| Assertion | Result |
| --- | --- |
| \`navigator.serviceWorker\` registers (active \`/sw.js\`) | ${r.swRegistered ? "PASS" : "FAIL"} |
| Active SW script served over HTTPS | \`${r.swScriptURL ?? ""}\` |
| SW **controls** the page (\`serviceWorker.controller\`) | ${r.swControlsPage ? "PASS" : "FAIL"} |
| Phone **pairs over HTTPS** (real tRPC through the TLS proxy) | ${r.pairedOverHttps ? "PASS" : "FAIL"} |
| \`pushManager.subscribe({ applicationServerKey })\` **RESOLVES** | ${r.pushSubscribed ? "PASS" : "FAIL"} |
| Subscription endpoint (real push service) | \`${endpoint}\` (host: \`${host}\`) |
| Subscription carries \`p256dh\` + \`auth\` keys | ${r.subscriptionHasKeys ? "PASS" : "FAIL"} |
| \`notifications.subscribePush\` stored it (UI reaches **On**) | ${r.subscribePushStored ? "PASS" : "FAIL"} |

The on-device opt-in surface reaching its **On** state ("This phone gets a push…") is the
end-to-end proof: the PWA only shows it after \`pushManager.subscribe\` resolved AND the host
accepted the subscription via \`notifications.subscribePush\`. Screenshot: \`./secure-context.png\`.

## How it was run (honest path — LOCAL evidence, not CI-gated)
- **Front:** \`caddy run\` with \`tls internal\` + \`reverse_proxy 127.0.0.1:<host-port>\`
  (\`skip_install_trust\`, throwaway storage) — self-signed HTTPS, never shipped to a device.
- **Browser:** branded **Google Chrome** (\`channel: "chrome"\`) in a **persistent
  (non-incognito) context** — required because the open-source Chromium bundled with
  Playwright lacks Google's FCM keys (answers "push service not available"), and Chrome
  disables the Push API in incognito. Launched with \`--ignore-certificate-errors\` so the SW
  script loads over the self-signed cert (Playwright's per-context \`ignoreHTTPSErrors\` does
  not cover SW script fetches), \`grantPermissions(['notifications'])\`, Pixel-5 viewport.
- **Why local:** a real FCM subscription is not reproducible on a headless CI runner and the
  cold push handshake is not deterministic enough to gate CI — so per ADR-0017 the CI proves
  packaging + the SW/secure-context surfaces it CAN (localhost), and THIS run is the recorded
  HTTPS+real-push proof. Re-run anytime with:
  \`GROVE_E2E_MEASURE=1 node ./node_modules/@playwright/test/cli.js test _secure-context.spec.ts\`
`;
  writeFileSync(join(EVIDENCE_DIR, "secure-context.md"), md, "utf8");
}
