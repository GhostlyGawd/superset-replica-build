import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "@swarm/db/store";
import type { WorkspaceId } from "@swarm/shared";
import * as webpushModule from "web-push";

/**
 * `web-push` is CommonJS. Under Node ESM its named bindings live on the synthetic
 * `default` export; Bun exposes them on the namespace directly. Pick whichever
 * actually carries the functions so the same code runs under both runtimes
 * (the host runs under Node, the unit tests under Bun — ADR-0007a).
 */
const webpush =
  (webpushModule as unknown as { default?: typeof webpushModule }).default ?? webpushModule;

/** A Web Push subscription type (from the namespace — a qualified type name). */
type WebPushSubscription = webpushModule.PushSubscription;

/**
 * Web Push / VAPID send path (ADR-0014 decision 5). The host owns ONE VAPID
 * keypair — generated once and persisted, so every device subscribes against a
 * stable application server key — and pushes a notification to each stored
 * subscription whenever a workspace flips to `needs_attention`. Transport is the
 * real `web-push` library (MIT); the only seam is `GROVE_PUSH_CAPTURE`, which
 * intercepts the request at the NETWORK boundary (it still runs the real VAPID
 * signing + payload encryption via `generateRequestDetails`) so a headless test
 * can assert a genuine push was produced without a live push service.
 */

/** The VAPID `subject` (RFC 8292): a contact URI. `mailto:` is accepted by every
 *  push service; this is the host's identity, not a user-facing address. */
const VAPID_SUBJECT = "mailto:grove@grove.local";

/** Env var that captures each web-push request to a JSON-lines file instead of
 *  POSTing it. A NETWORK-boundary test seam only — production never sets it. */
export const PUSH_CAPTURE_ENV = "GROVE_PUSH_CAPTURE";

export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** A captured push request — what the test seam writes (no live transport). */
export interface CapturedPush {
  readonly endpoint: string;
  readonly hasAuthorization: boolean;
  readonly hasEncryptedBody: boolean;
  readonly payload: unknown;
}

/**
 * Load the host's VAPID keypair from `<dir>/vapid.json`, generating + persisting
 * one on first run. Generated ONCE and reused (ADR-0014): rotating it would
 * invalidate every device's existing subscription, so it is sticky on disk.
 */
export function loadOrCreateVapid(dir: string): VapidKeys {
  const file = join(dir, "vapid.json");
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<VapidKeys>;
      if (
        typeof parsed.publicKey === "string" &&
        parsed.publicKey.length > 0 &&
        typeof parsed.privateKey === "string" &&
        parsed.privateKey.length > 0
      ) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    } catch {
      // A corrupt file is replaced below rather than crashing the host.
    }
  }
  const generated = webpush.generateVAPIDKeys();
  const keys: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, "utf8");
  return keys;
}

/** A Web Push subscription as a browser's `pushManager.subscribe(...).toJSON()` yields. */
export interface StoredSubscription {
  readonly endpoint: string;
  readonly keys: Readonly<Record<string, string>>;
}

function toWebPushSubscription(sub: StoredSubscription): WebPushSubscription {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.keys.p256dh ?? "",
      auth: sub.keys.auth ?? "",
    },
  };
}

export interface PushSenderOptions {
  readonly store: Store;
  readonly vapid: VapidKeys;
  /** When set, capture requests to this file (JSON lines) instead of sending. */
  readonly captureFile?: string | undefined;
  /** Injectable for tests; defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

/**
 * Sends a Web Push to every stored subscription when a workspace needs attention,
 * recording a durable `notifications` row first so the phone's inbox shows it even
 * if the device was offline when the push fired.
 */
export class PushSender {
  private readonly store: Store;
  private readonly vapid: VapidKeys;
  private readonly captureFile: string | undefined;
  private readonly warn: (message: string) => void;

  constructor(options: PushSenderOptions) {
    this.store = options.store;
    this.vapid = options.vapid;
    this.captureFile = options.captureFile;
    this.warn = options.warn ?? ((message) => console.warn(message));
  }

  /** The VAPID details every send signs with. */
  private get vapidDetails(): { subject: string; publicKey: string; privateKey: string } {
    return {
      subject: VAPID_SUBJECT,
      publicKey: this.vapid.publicKey,
      privateKey: this.vapid.privateKey,
    };
  }

  /**
   * Record a `needs_attention` notification and push it to every subscribed device.
   * Idempotent per call; resolves once all sends settle so callers (and tests) can
   * await the fan-out. A failed/expired subscription is pruned, never fatal.
   */
  async notifyNeedsAttention(workspaceId: WorkspaceId): Promise<void> {
    const workspace = await this.store.getWorkspace(workspaceId);
    const name = workspace?.name ?? workspaceId;
    const title = `${name} needs your attention`;
    const body = "An agent is waiting for your input.";

    await this.store.createNotification({
      workspaceId,
      kind: "needs_attention",
      title,
      body,
    });

    const payload = {
      title,
      body,
      kind: "needs_attention",
      workspaceId,
      // The SW focuses/opens the app at the root; the phone routes to the worktree.
      url: "/",
      tag: `needs_attention:${workspaceId}`,
    };

    const subscriptions = await this.store.listPushSubscriptions();
    await Promise.all(subscriptions.map((sub) => this.sendOne(sub, payload)));
  }

  private async sendOne(sub: StoredSubscription, payload: unknown): Promise<void> {
    const subscription = toWebPushSubscription(sub);
    const body = JSON.stringify(payload);

    if (this.captureFile) {
      // Network-boundary seam: run the REAL VAPID signing + payload encryption, then
      // record the request instead of POSTing it (no live push service in tests).
      try {
        const details = webpush.generateRequestDetails(subscription, body, {
          vapidDetails: this.vapidDetails,
          TTL: 60,
        });
        const headers = (details.headers ?? {}) as Record<string, string>;
        const captured: CapturedPush = {
          endpoint: details.endpoint,
          hasAuthorization:
            typeof headers.Authorization === "string" && headers.Authorization.length > 0,
          hasEncryptedBody:
            details.body != null && (details.body as { length?: number }).length !== 0,
          payload,
        };
        appendFileSync(this.captureFile, `${JSON.stringify(captured)}\n`, "utf8");
      } catch (error) {
        this.warn(`push capture failed for ${sub.endpoint}: ${String(error)}`);
      }
      return;
    }

    try {
      await webpush.sendNotification(subscription, body, {
        vapidDetails: this.vapidDetails,
        TTL: 60,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      // 404/410 mean the subscription is dead (unsubscribed / expired) — prune it.
      if (statusCode === 404 || statusCode === 410) {
        await this.store.removePushSubscription(sub.endpoint);
        return;
      }
      this.warn(`web-push send failed for ${sub.endpoint}: ${String(error)}`);
    }
  }
}
