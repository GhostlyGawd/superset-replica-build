import type { HostTrpcClient } from "./host-client.ts";

/**
 * Browser-side Web Push opt-in (ADR-0014 decision 5). The user taps "Enable
 * notifications" (a real gesture), we request permission, subscribe via the SW's
 * `pushManager` against the host's VAPID public key, and register the resulting
 * subscription with the host (`notifications.subscribePush`). Everything here runs
 * only on a secure context (localhost / HTTPS); on a plain-HTTP LAN origin the
 * browser exposes no `serviceWorker`/`PushManager`, which we surface honestly.
 *
 * iOS NOTE: Web Push works ONLY for an INSTALLED PWA on iOS 16.4+, and the subscribe
 * must happen from a user gesture (both satisfied by this opt-in button once added
 * to the Home Screen). Until installed, iOS Safari reports push as unsupported.
 */

/** Whether this context can even attempt push (secure context + the two APIs). */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The current Notification permission, or `"unsupported"` off a secure context. */
export function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

/** Convert a base64url VAPID public key to the `ArrayBuffer` `subscribe` expects
 *  as its `applicationServerKey` (a `BufferSource`). */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    view[i] = raw.charCodeAt(i);
  }
  return buffer;
}

export type PushOptInResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "unsupported" | "denied" | "dismissed" | "failed";
      readonly message: string;
    };

/**
 * Request permission, subscribe, and register the subscription with the host.
 * Reuses an existing subscription when present (so re-enabling is idempotent).
 */
export async function enablePush(
  client: HostTrpcClient,
  vapidPublicKey: string,
): Promise<PushOptInResult> {
  if (!isPushSupported()) {
    return {
      ok: false,
      reason: "unsupported",
      message:
        "This browser can't enable push here. Install the app on a secure origin to turn it on.",
    };
  }

  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    return {
      ok: false,
      reason: "denied",
      message: "Notifications are blocked. Allow them for this site in your browser settings.",
    };
  }
  if (permission !== "granted") {
    return { ok: false, reason: "dismissed", message: "Notifications permission was not granted." };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
      }));

    const json = subscription.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return { ok: false, reason: "failed", message: "The push subscription was incomplete." };
    }

    await client.notifications.subscribePush.mutate({
      subscription: { endpoint, keys: { p256dh, auth } },
    });
    return { ok: true };
  } catch (error) {
    // Headless / no-push-service browsers reject `subscribe` even on a secure context.
    return {
      ok: false,
      reason: "failed",
      message:
        error instanceof Error && error.message
          ? `Couldn't enable push: ${error.message}`
          : "Couldn't enable push in this browser.",
    };
  }
}
