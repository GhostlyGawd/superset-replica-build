import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "@swarm/db/store";
import type { WorkspaceId } from "@swarm/shared";
import { PushSender, loadOrCreateVapid } from "./push.ts";
import { runWorker } from "./spawn-worker.ts";

/**
 * Three layers of proof for the ADR-0014 Web Push send path:
 *   1. `loadOrCreateVapid` generates a keypair once and reuses it (under Bun).
 *   2. `PushSender` capture seam (under Bun): a `needs_attention` records a row AND
 *      produces a REAL web-push request (VAPID-signed, payload encrypted) to the
 *      stored subscription — captured at the network boundary, no live push service.
 *   3. A REAL host round-trip in a spawned Node child (node-pty can't run under Bun on
 *      Windows, ADR-0007a): subscribe → real needs_attention transition → web-push
 *      captured → notification row → markRead.
 */

/** A REAL subscription — genuine P-256 ECDH public key + 16-byte auth, the exact
 *  shape a browser's `pushManager.subscribe(...).toJSON()` yields. */
function makeSubscription(endpoint: string): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

describe("VAPID key persistence (generate once, reuse)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grove-vapid-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  test("generates a keypair on first call and persists it to disk", () => {
    const keys = loadOrCreateVapid(dir);
    expect(keys.publicKey.length).toBeGreaterThan(0);
    expect(keys.privateKey.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "vapid.json"))).toBe(true);
  });

  test("returns the SAME keypair on a second call (reuse, never rotates)", () => {
    const first = loadOrCreateVapid(dir);
    const second = loadOrCreateVapid(dir);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey).toBe(first.privateKey);
  });
});

describe("PushSender capture seam (real VAPID signing + encryption)", () => {
  let dir: string;
  let captureFile: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "grove-push-"));
    captureFile = join(dir, "capture.jsonl");
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  test("needs_attention records a notification AND produces a real web-push request", async () => {
    const vapid = loadOrCreateVapid(dir);
    const subscription = makeSubscription("https://push.example.com/sub/unit-test");
    const created: Array<{ kind: string; title: string }> = [];

    // A minimal in-memory store stub — a UNIT-test double for the send logic; the
    // Node worker exercises the same path against the REAL PGlite store.
    const store = {
      getWorkspace: async () => ({ name: "feat/unit-demo" }),
      createNotification: async (input: { kind: string; title: string }) => {
        created.push({ kind: input.kind, title: input.title });
        return {} as unknown;
      },
      listPushSubscriptions: async () => [
        { id: "x", endpoint: subscription.endpoint, keys: subscription.keys, createdAt: "" },
      ],
      removePushSubscription: async () => {},
    } as unknown as Store;

    const sender = new PushSender({ store, vapid, captureFile });
    await sender.notifyNeedsAttention("wsp_unit" as WorkspaceId);

    // The notification row was recorded.
    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("needs_attention");
    expect(created[0]?.title).toContain("feat/unit-demo");

    // A genuine web-push request was produced for the subscription.
    const lines = readFileSync(captureFile, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            endpoint: string;
            hasAuthorization: boolean;
            hasEncryptedBody: boolean;
            payload: { kind?: string };
          },
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endpoint).toBe(subscription.endpoint);
    expect(lines[0]?.hasAuthorization).toBe(true);
    expect(lines[0]?.hasEncryptedBody).toBe(true);
    expect(lines[0]?.payload.kind).toBe("needs_attention");
  });
});

const WORKER = fileURLToPath(new URL("./notifications-worker.ts", import.meta.url));
const TMP_PREFIX = join(tmpdir(), "grove notif-");

interface NotifReport {
  subscribeNoAuthStatus: number;
  subscribeStatus: number;
  vapidKeyLength: number;
  capturedCount: number;
  capturedEndpointMatches: boolean;
  capturedHasAuthorization: boolean;
  capturedHasEncryptedBody: boolean;
  notificationTitle: string;
  notificationCreated: boolean;
  unreadBefore: number;
  unreadAfter: number;
  rowReadAfter: boolean;
}

let root: string;
let out: string;
let exitStatus: number | null;
let report: NotifReport | undefined;

beforeAll(async () => {
  root = mkdtempSync(TMP_PREFIX);
  const result = await runWorker("node", [WORKER, root], 120_000);
  out = result.out;
  exitStatus = result.status;
  const begin = out.indexOf("HOST_REPORT_BEGIN");
  const end = out.indexOf("HOST_REPORT_END");
  if (begin >= 0 && end > begin) {
    report = JSON.parse(out.slice(begin + "HOST_REPORT_BEGIN".length, end)) as NotifReport;
  }
}, 150_000);

afterAll(async () => {
  if (root) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // best-effort.
    }
  }
});

describe("@swarm/host — Web Push send path over the real host (via Node)", () => {
  test("the notifications worker run passed end-to-end", () => {
    expect(out, out).toContain("WORKER_RESULT=PASS");
    expect(exitStatus).toBe(0);
    expect(report).toBeDefined();
  });

  test("subscribePush is bearer-gated; the host exposes a VAPID public key", () => {
    expect(report?.subscribeNoAuthStatus).toBe(401);
    expect(report?.subscribeStatus).toBe(200);
    expect(report?.vapidKeyLength).toBeGreaterThan(0);
  });

  test("a needs_attention transition fires a real web-push to the stored subscription", () => {
    expect(report?.capturedCount).toBeGreaterThanOrEqual(1);
    expect(report?.capturedEndpointMatches).toBe(true);
    expect(report?.capturedHasAuthorization).toBe(true);
    expect(report?.capturedHasEncryptedBody).toBe(true);
  });

  test("the transition records a notification row, and markRead flips it", () => {
    expect(report?.notificationCreated).toBe(true);
    expect(report?.notificationTitle).toContain("feat/push-demo");
    expect(report?.unreadBefore).toBeGreaterThanOrEqual(1);
    expect(report?.unreadAfter).toBe((report?.unreadBefore ?? 0) - 1);
    expect(report?.rowReadAfter).toBe(true);
  });
});
