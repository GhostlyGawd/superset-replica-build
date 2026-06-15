/**
 * notifications-worker — runs UNDER NODE (the host builds a PtySupervisor whose
 * node-pty ConPTY pipe throws under Bun on Windows, ADR-0007a). Spawned by
 * `notifications.test.ts`, it stands up the REAL host and drives the whole Web
 * Push send path end-to-end (ADR-0014 decision 5):
 *
 *   1. `notifications.subscribePush` (bearer-gated) stores a REAL subscription
 *      (genuine P-256 ECDH keys, exactly a browser's `pushManager` shape);
 *   2. a REAL `workspace.status_changed → needs_attention` event is appended to the
 *      SAME event log the orchestrator uses — the production trigger;
 *   3. the host's subscriber records a `notifications` row AND fires `web-push`,
 *      captured at the NETWORK boundary by `GROVE_PUSH_CAPTURE` (real VAPID signing
 *      + payload encryption via `generateRequestDetails`, no live push service);
 *   4. `notifications.list` returns the row, and `markRead` flips it.
 *
 * argv[2] = a temp root dir. Emits HOST_REPORT_BEGIN/END JSON + a WORKER_RESULT line.
 */
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { argv, env, exit, stdout } from "node:process";
import { openStore } from "@swarm/db/store";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { PUSH_CAPTURE_ENV } from "./push.ts";
import { startHost } from "./server.ts";
import { finishWorker } from "./worker-exit.ts";

interface JsonEnvelope {
  readonly result?: { readonly data?: unknown };
}

function httpCall(
  endpoint: string,
  path: string,
  options: { method: "GET" | "POST"; body?: unknown; token?: string },
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${endpoint}/trpc/${path}`);
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = {};
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers,
        agent: false,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data: unknown;
          try {
            data = (JSON.parse(raw) as JsonEnvelope).result?.data;
          } catch {
            data = undefined;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

const post = (endpoint: string, path: string, input: unknown, token?: string) =>
  httpCall(endpoint, path, { method: "POST", body: input, token });
const get = (endpoint: string, path: string, token?: string) =>
  httpCall(endpoint, path, { method: "GET", token });

/** A REAL Web Push subscription: a genuine P-256 ECDH public key + 16-byte auth,
 *  the exact shape `pushManager.subscribe(...).toJSON()` yields in a browser. */
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

interface CapturedLine {
  endpoint: string;
  hasAuthorization: boolean;
  hasEncryptedBody: boolean;
  payload: { kind?: string; workspaceId?: string };
}

function readCapture(file: string): CapturedLine[] {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CapturedLine);
}

interface NotificationRow {
  id: string;
  workspaceId: string | null;
  kind: string;
  title: string;
  read: boolean;
}

async function main(): Promise<number> {
  stdout.write("WORKER_BOOT notifications\n");
  let cleanup: () => Promise<void> = async () => {};

  try {
    const rootDir = argv[2];
    if (!rootDir) {
      await finishWorker("WORKER_RESULT=FAIL reason=no-root-dir", 1, cleanup);
      return 1;
    }

    const captureFile = join(rootDir, "push-capture.jsonl");
    // The NETWORK-boundary test seam: capture web-push requests instead of POSTing.
    env[PUSH_CAPTURE_ENV] = captureFile;

    const store = await openStore({ dataDir: join(rootDir, "pg") });
    const hostId = asId<"HostId">("grove-host-notif");
    const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
    const supervisor = new PtySupervisor();
    const host = await startHost({
      store,
      eventLog,
      supervisor,
      hostId,
      host: "127.0.0.1",
      port: 0,
      manifestDir: join(rootDir, "manifest"),
      heartbeatMs: 0,
      pwaDir: join(rootDir, "no-pwa"),
    });
    cleanup = async () => {
      await host.close();
      await store.close();
    };

    const project = await store.createProject({
      name: "fixture",
      localPath: join(rootDir, "repo"),
      defaultBranch: "main",
    });
    const workspace = await store.createWorkspace({
      projectId: project.id,
      name: "feat/push-demo",
      branch: "grove/push-demo",
      baseBranch: "main",
      worktreePath: join(rootDir, "wt", "push"),
      status: "running",
    });

    const ep = host.endpoint;

    // 1. Register a real subscription (bearer-gated). Without a bearer → 401.
    const sub = makeSubscription("https://push.example.com/sub/grove-test-device");
    const subNoAuth = await post(ep, "notifications.subscribePush", { subscription: sub });
    const subscribe = await post(
      ep,
      "notifications.subscribePush",
      { subscription: sub },
      host.token,
    );

    // The PWA learns the VAPID public key to subscribe with.
    const vapid = await get(ep, "notifications.vapidPublicKey", host.token);
    const vapidKey = (vapid.data as { key?: string } | undefined)?.key ?? "";

    // 2. The REAL trigger: a needs_attention transition on the shared event log.
    await eventLog.append({
      type: "workspace.status_changed",
      workspaceId: workspace.id,
      status: "needs_attention",
    });

    // 3. The send path is async (fire-and-forget from the subscriber) — poll the
    //    capture file until the web-push request lands (bounded).
    let captured: CapturedLine[] = [];
    for (let i = 0; i < 100 && captured.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      captured = readCapture(captureFile);
    }
    const hit = captured.find((c) => c.payload.workspaceId === workspace.id);

    // 4. The notification row exists, then markRead flips it.
    const listBefore = await get(ep, "notifications.list", host.token);
    const rows = (listBefore.data as NotificationRow[] | undefined) ?? [];
    const row = rows.find((r) => r.kind === "needs_attention" && r.workspaceId === workspace.id);
    const unreadBefore = rows.filter((r) => !r.read).length;

    if (row) {
      await post(ep, "notifications.markRead", { id: row.id }, host.token);
    }
    const listAfter = await get(ep, "notifications.list", host.token);
    const rowsAfter = (listAfter.data as NotificationRow[] | undefined) ?? [];
    const unreadAfter = rowsAfter.filter((r) => !r.read).length;
    const rowReadAfter = rowsAfter.find((r) => r.id === row?.id)?.read === true;

    const report = {
      subscribeNoAuthStatus: subNoAuth.status,
      subscribeStatus: subscribe.status,
      vapidKeyLength: vapidKey.length,
      capturedCount: captured.length,
      capturedEndpointMatches: hit?.endpoint === sub.endpoint,
      capturedHasAuthorization: hit?.hasAuthorization === true,
      capturedHasEncryptedBody: hit?.hasEncryptedBody === true,
      notificationTitle: row?.title ?? "",
      notificationCreated: row !== undefined,
      unreadBefore,
      unreadAfter,
      rowReadAfter,
    };

    const pass =
      report.subscribeNoAuthStatus === 401 &&
      report.subscribeStatus === 200 &&
      report.vapidKeyLength > 0 &&
      report.capturedCount >= 1 &&
      report.capturedEndpointMatches &&
      report.capturedHasAuthorization &&
      report.capturedHasEncryptedBody &&
      report.notificationCreated &&
      report.notificationTitle.includes("feat/push-demo") &&
      report.unreadBefore >= 1 &&
      report.unreadAfter === report.unreadBefore - 1 &&
      report.rowReadAfter;

    console.log("HOST_REPORT_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("HOST_REPORT_END");
    const exitCode = pass ? 0 : 1;
    await finishWorker(`WORKER_RESULT=${pass ? "PASS" : "FAIL"}`, exitCode, cleanup);
    return exitCode;
  } catch (error) {
    const reason =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    await finishWorker(`WORKER_RESULT=FAIL reason=${reason}`, 1, cleanup);
    return 1;
  }
}

main().then(
  (code) => exit(code),
  (error: unknown) => {
    const reason =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    stdout.write(`WORKER_RESULT=FAIL reason=${reason}\n`, () => exit(1));
  },
);
