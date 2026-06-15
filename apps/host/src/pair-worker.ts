/**
 * pair-worker — runs UNDER NODE (the host constructs a PtySupervisor, whose node-pty
 * ConPTY pipe throws ERR_SOCKET_CLOSED under Bun on Windows, ADR-0007a). Spawned by
 * `pair-roundtrip.test.ts`, it stands up the REAL host (Hono + tRPC + WS + PGlite),
 * seeds a project + workspace directly over the store, then drives the ENTIRE pairing
 * round-trip over real HTTP (ADR-0014):
 *
 *   1. `pair.start` WITHOUT the bearer → 401 (bearer-gated like every other proc);
 *   2. `pair.start` WITH the bearer → a single-use code;
 *   3. `pair.redeem` PUBLIC (no bearer) with that code → the host bearer + resume token;
 *   4. an authenticated `workspaces.list` WITH the redeemed bearer → the seeded rows;
 *   5. `pair.redeem` of the SAME code again → rejected (single-use);
 *   6. `pair.redeem` of a BOGUS code → rejected (invalid);
 *   7. `workspaces.list` WITHOUT a bearer → 401 (the guard still bites everything else).
 *
 * argv[2] = a temp root dir for the PGlite data. Emits HOST_REPORT_BEGIN/END JSON
 * plus a WORKER_RESULT line the bun test parses.
 */
import { request } from "node:http";
import { join } from "node:path";
import { argv, exit, stdout } from "node:process";
import { openStore } from "@swarm/db/store";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { startHost } from "./server.ts";
import { finishWorker } from "./worker-exit.ts";

interface JsonEnvelope {
  readonly result?: { readonly data?: unknown };
}

/**
 * One tRPC call over `node:http` with `agent: false` (NO keep-alive pooling). We use
 * raw http rather than `fetch` deliberately: undici's pooled keep-alive sockets are
 * the async handles that trip the Windows `uv_close` assertion at process exit (the
 * other host workers only dodge it by draining live WS clients first). A non-pooled
 * socket closes with its response, so nothing lingers to abort the worker on exit.
 */
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

/** POST a single (non-batched) tRPC mutation. */
function postProc(
  endpoint: string,
  path: string,
  input: unknown,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  return httpCall(endpoint, path, { method: "POST", body: input, token });
}

/** GET a tRPC query. */
function getProc(
  endpoint: string,
  path: string,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  return httpCall(endpoint, path, { method: "GET", token });
}

async function main(): Promise<number> {
  stdout.write("WORKER_BOOT pair\n");
  let cleanup: () => Promise<void> = async () => {};

  try {
    const rootDir = argv[2];
    if (!rootDir) {
      await finishWorker("WORKER_RESULT=FAIL reason=no-root-dir", 1, cleanup);
      return 1;
    }

    const store = await openStore({ dataDir: join(rootDir, "pg") });
    const hostId = asId<"HostId">("grove-host-pair");
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
      // No PWA dir for this API test — keeps static serving out of the round-trip.
      pwaDir: join(rootDir, "no-pwa"),
    });
    cleanup = async () => {
      // Graceful close (server + PGlite worker handle) so `exit()` has nothing left
      // to tear down. The non-pooled node:http client above left no client sockets.
      await host.close();
      await store.close();
    };
    const project = await store.createProject({
      name: "fixture",
      localPath: join(rootDir, "repo"),
      defaultBranch: "main",
    });
    await store.createWorkspace({
      projectId: project.id,
      name: "feat/pairing",
      branch: "grove/pairing",
      baseBranch: "main",
      worktreePath: join(rootDir, "wt", "pairing"),
      status: "idle",
    });

    const ep = host.endpoint;

    // 1. start without the bearer → 401.
    const startNoAuth = await postProc(ep, "pair.start", {});
    // 2. start with the bearer → a code.
    const start = await postProc(ep, "pair.start", {}, host.token);
    const code = (start.data as { code?: string } | undefined)?.code ?? "";

    // 3. redeem PUBLICLY (no bearer) → the host bearer + resume token.
    const redeem = await postProc(ep, "pair.redeem", { code });
    const grant = redeem.data as { token?: string; resumeToken?: string } | undefined;
    const redeemedToken = grant?.token ?? "";
    const redeemTokenMatches = redeemedToken === host.token;
    const hasResumeToken = typeof grant?.resumeToken === "string" && grant.resumeToken.length > 0;

    // 4. authenticated workspaces.list WITH the redeemed bearer → seeded rows.
    const authedList = await getProc(ep, "workspaces.list", redeemedToken);
    const authedListCount = Array.isArray(authedList.data) ? authedList.data.length : 0;

    // 5. reuse the SAME code → rejected (single-use).
    const reusedRedeem = await postProc(ep, "pair.redeem", { code });
    // 6. bogus code → rejected (invalid).
    const badRedeem = await postProc(ep, "pair.redeem", { code: "ZZZZZZZZ" });
    // 7. workspaces.list without a bearer → 401.
    const unauthList = await getProc(ep, "workspaces.list");

    const report = {
      startNoAuthStatus: startNoAuth.status,
      startStatus: start.status,
      codeLength: code.length,
      redeemStatus: redeem.status,
      redeemTokenMatches,
      hasResumeToken,
      authedListStatus: authedList.status,
      authedListCount,
      reusedRedeemStatus: reusedRedeem.status,
      badRedeemStatus: badRedeem.status,
      unauthListStatus: unauthList.status,
    };

    const pass =
      startNoAuth.status === 401 &&
      start.status === 200 &&
      code.length === 8 &&
      redeem.status === 200 &&
      redeemTokenMatches &&
      hasResumeToken &&
      authedList.status === 200 &&
      authedListCount >= 1 &&
      reusedRedeem.status === 401 &&
      badRedeem.status === 401 &&
      unauthList.status === 401;

    console.log("HOST_REPORT_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("HOST_REPORT_END");
    const code2 = pass ? 0 : 1;
    await finishWorker(`WORKER_RESULT=${pass ? "PASS" : "FAIL"}`, code2, cleanup);
    return code2;
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
