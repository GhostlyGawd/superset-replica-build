/**
 * host-worker — runs UNDER NODE (never Bun: the orchestrator drives node-pty via
 * the PtySupervisor, whose ConPTY pipe throws ERR_SOCKET_CLOSED under Bun on
 * Windows, ADR-0007a). Spawned by `host-integration.test.ts`, it stands up the
 * REAL host (Hono + tRPC + WS sync + PGlite) and proves the Phase-2 core
 * capability: many CLI agents running in parallel, each isolated in its own git
 * worktree, with live status.
 *
 * It emits a single JSON report (between HOST_REPORT_BEGIN/END) plus a
 * HOST_RESULT line; the bun test parses these and adds its own independent,
 * on-disk isolation checks. argv[2] = the temp root dir (containing repo/).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fakeCliPath } from "@swarm/agent-adapters";
import type { DomainEvent } from "@swarm/core-engine";
import { openStore } from "@swarm/db/store";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog, SyncClient } from "@swarm/sync";
import { webSocketTransport } from "@swarm/sync/server";
import { Orchestrator } from "./orchestrator.ts";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { startHost } from "./server.ts";
import { finishWorker } from "./worker-exit.ts";

// The 3 parallel agents use the keyless mock under an EXPLICIT per-call flag
// (`enableMock:true`, a legitimate test use); the tRPC command path below runs a
// REAL `generic` adapter. The process-wide `SWARM_ENABLE_MOCK_ADAPTER` env gate is
// deliberately NOT set, proving the mock is unreachable on the API/user path.

interface LiveRecord {
  readonly seq: number;
  readonly type: string;
  readonly workspaceId: string | null;
  readonly status: string | null;
  readonly t: number;
}

function statusOf(event: DomainEvent): string | null {
  return event.type === "workspace.status_changed" ? event.status : null;
}

function workspaceIdOf(event: DomainEvent): string | null {
  return "workspaceId" in event ? event.workspaceId : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  deadlineMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await predicate()) {
      return true;
    }
    await delay(50);
  }
  return Promise.resolve(predicate());
}

interface JsonResult {
  readonly result?: { readonly data?: unknown };
}

async function trpcQuery(endpoint: string, token: string, path: string): Promise<Response> {
  return fetch(`${endpoint}/trpc/${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function trpcMutation(
  endpoint: string,
  token: string,
  path: string,
  input: unknown,
): Promise<unknown> {
  const res = await fetch(`${endpoint}/trpc/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`tRPC ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as JsonResult;
  return body.result?.data;
}

async function main(): Promise<number> {
  const rootDir = argv[2];
  if (!rootDir) {
    console.log("WORKER_RESULT=FAIL reason=no-root-dir");
    return 1;
  }
  const repoRoot = join(rootDir, "repo");
  const pgDir = join(rootDir, "pg");
  const worktreesDir = join(rootDir, "worktrees");
  const manifestDir = join(rootDir, "manifest");

  const store = await openStore({ dataDir: pgDir });
  const hostId = asId<"HostId">("grove-host-it");
  const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
  const supervisor = new PtySupervisor();
  const orchestrator = new Orchestrator({
    store,
    eventLog,
    supervisor,
    worktreesRoot: worktreesDir,
  });

  // P04: a subscriber on the sync EventLog (in-process), timestamped.
  const live: LiveRecord[] = [];
  const unsubscribe = eventLog.subscribe((stored) => {
    live.push({
      seq: stored.seq,
      type: stored.event.type,
      workspaceId: workspaceIdOf(stored.event),
      status: statusOf(stored.event),
      t: Date.now(),
    });
  });

  const host = await startHost({
    store,
    eventLog,
    orchestrator,
    hostId,
    host: "127.0.0.1",
    port: 0,
    manifestDir,
    heartbeatMs: 0,
  });

  // ---- Auth (P11) over HTTP --------------------------------------------------
  const noTokenRes = await fetch(`${host.endpoint}/trpc/host.status`);
  const httpNoToken = noTokenRes.status;
  await noTokenRes.text();
  const withTokenRes = await trpcQuery(host.endpoint, host.token, "host.status");
  const httpWithToken = withTokenRes.status;
  let httpHostId = "";
  try {
    const body = (await withTokenRes.json()) as JsonResult;
    httpHostId = (body.result?.data as { hostId?: string } | undefined)?.hostId ?? "";
  } catch {
    httpHostId = "";
  }

  // ---- Auth (P11) over the WS sync channel -----------------------------------
  const wsNoToken = new SyncClient({
    transport: webSocketTransport(host.wsUrl),
    hostId,
    autoReconnect: false,
    onEvent: () => {},
  });
  wsNoToken.start();
  await delay(700);
  const wsRejectedNoToken = wsNoToken.getState() !== "live";
  wsNoToken.close();

  // ---- Live status over the real socket (P04) --------------------------------
  const wsApplied: number[] = [];
  const wsReceived: LiveRecord[] = [];
  const wsClient = new SyncClient({
    transport: webSocketTransport(`${host.wsUrl}?token=${host.token}`),
    hostId,
    autoReconnect: false,
    ackEvery: 1,
    onEvent: (e) => {
      wsApplied.push(e.seq);
      wsReceived.push({
        seq: e.seq,
        type: e.event.type,
        workspaceId: workspaceIdOf(e.event),
        status: statusOf(e.event),
        t: Date.now(),
      });
    },
  });
  wsClient.start();
  await waitUntil(() => wsClient.getState() === "live", 5000);

  // ---- P02 isolation setup: one worktree+branch per task (sequential) --------
  const project = await store.createProject({
    name: "fixture",
    localPath: repoRoot,
    defaultBranch: "main",
  });

  const specs = [
    { name: "agent-alpha", branch: "grove/agent-alpha", fileName: "alpha.md" },
    { name: "agent-bravo", branch: "grove/agent-bravo", fileName: "bravo.md" },
    { name: "agent-charlie", branch: "grove/agent-charlie", fileName: "charlie.md" },
  ] as const;

  const prepared: Array<{
    spec: (typeof specs)[number];
    prepared: Awaited<ReturnType<Orchestrator["createWorkspace"]>>;
  }> = [];
  for (const spec of specs) {
    const p = await orchestrator.createWorkspace({
      project,
      name: spec.name,
      branch: spec.branch,
      baseBranch: "main",
      worktreesDir,
    });
    prepared.push({ spec, prepared: p });
  }

  // ---- P01 parallelism: launch all agents concurrently, own PTY each ---------
  const workMs = 1200;
  const t0 = Date.now();
  const started = await Promise.all(
    prepared.map(({ spec, prepared: p }) =>
      orchestrator.startAgent(p, {
        adapterId: "mock",
        enableMock: true,
        workMs,
        fileName: spec.fileName,
      }),
    ),
  );
  await Promise.all(started.map((r) => r.done));
  const t1 = Date.now();
  for (const run of started) {
    await run.stop();
  }

  // ---- tRPC command path end-to-end: a 4th agent via the API, dispatched to a
  // ---- REAL adapter (P03). The `generic` adapter runs a trivially-present CLI
  // ---- (`node <fake-cli.mjs>`) over the universal terminal adapter — NOT the
  // ---- mock, and with no mock gate set — proving the real dispatch path.
  const deltaWs = (await trpcMutation(host.endpoint, host.token, "workspaces.create", {
    projectId: project.id,
    name: "agent-delta",
    branch: "grove/agent-delta",
    baseBranch: "main",
  })) as { id: string; worktreePath: string };
  const deltaSession = (await trpcMutation(host.endpoint, host.token, "agents.start", {
    workspaceId: deltaWs.id,
    adapterId: "generic",
    command: "node",
    args: [fakeCliPath(), "--file", "delta.md", "--work-ms", "400"],
  })) as { id: string; adapterId: string };
  await waitUntil(
    async () => (await store.getWorkspace(asId<"WorkspaceId">(deltaWs.id)))?.status === "done",
    30_000,
  );
  await trpcMutation(host.endpoint, host.token, "agents.stop", { sessionId: deltaSession.id });
  const deltaWorkspace = await store.getWorkspace(asId<"WorkspaceId">(deltaWs.id));

  // Drain the WS tail so the live-over-socket assertion sees every event.
  const head = await eventLog.head();
  await waitUntil(() => wsClient.getLastSeq() >= head, 5000);
  wsClient.close();
  unsubscribe();

  // ---- Persistence (P10): query stored events + sessions ---------------------
  const maxSeq = await store.maxSeq();
  const allRows = await store.readEventsFromSeq(0, { hostId });
  const byWorkspace: Record<string, { count: number; types: string[] }> = {};
  for (const row of allRows) {
    const key = row.workspaceId ?? "none";
    const bucket = byWorkspace[key] ?? { count: 0, types: [] };
    bucket.count += 1;
    bucket.types.push(row.type);
    byWorkspace[key] = bucket;
  }

  const sessionsByWorkspace: Record<
    string,
    Array<{ status: string; exitCode: number | null }>
  > = {};
  for (const { prepared: p } of prepared) {
    const rows = await store.listSessions(p.workspace.id);
    sessionsByWorkspace[p.workspace.id] = rows.map((s) => ({
      status: s.status,
      exitCode: s.exitCode,
    }));
  }

  // ---- Parallelism evidence from the timestamped live records ----------------
  const agents = started.map((r, i) => {
    const wsId = r.workspace.id as string;
    const statusOrder = live
      .filter((l) => l.workspaceId === wsId && l.status !== null)
      .map((l) => l.status as string);
    const runningAt = live.find((l) => l.workspaceId === wsId && l.status === "running")?.t ?? null;
    const doneAt = live.find((l) => l.workspaceId === wsId && l.status === "done")?.t ?? null;
    return {
      name: r.workspace.name,
      branch: r.branch,
      workspaceId: wsId,
      sessionId: r.session.id as string,
      worktreePath: r.worktreePath,
      fileName: prepared[i]?.spec.fileName ?? "",
      outputFile: r.outputFile,
      statusOrder,
      runningAt,
      doneAt,
      eventCount: byWorkspace[wsId]?.count ?? 0,
    };
  });

  // Max simultaneously-running agents via an interval sweep.
  const points: Array<[number, number]> = [];
  for (const a of agents) {
    if (a.runningAt !== null && a.doneAt !== null) {
      points.push([a.runningAt, 1]);
      points.push([a.doneAt, -1]);
    }
  }
  points.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let current = 0;
  let maxConcurrent = 0;
  for (const [, delta] of points) {
    current += delta;
    maxConcurrent = Math.max(maxConcurrent, current);
  }
  const sumMs = agents.reduce(
    (acc, a) => acc + (a.runningAt !== null && a.doneAt !== null ? a.doneAt - a.runningAt : 0),
    0,
  );
  const wallMs = t1 - t0;
  const concurrencyRatio = wallMs > 0 ? sumMs / wallMs : 0;

  // Manifest was written to disk (read it back before close removes it).
  let manifestOnDisk: unknown = null;
  let manifestExisted = false;
  try {
    manifestOnDisk = JSON.parse(readFileSync(host.manifestPath, "utf8"));
    manifestExisted = true;
  } catch {
    manifestExisted = false;
  }

  const wsStatusEvents = wsReceived.filter((r) => r.status !== null);

  const report = {
    endpoint: host.endpoint,
    wsUrl: host.wsUrl,
    port: host.port,
    hostId: host.hostId as string,
    tokenLength: host.token.length,
    manifestPath: host.manifestPath,
    manifestExisted,
    manifest: manifestOnDisk,
    auth: { httpNoToken, httpWithToken, httpHostId, wsRejectedNoToken },
    parallel: { wallMs, sumMs, concurrencyRatio, maxConcurrent, agentCount: agents.length },
    agents,
    delta: {
      workspaceId: deltaWs.id,
      sessionId: deltaSession.id,
      adapterId: deltaSession.adapterId,
      status: deltaWorkspace?.status ?? null,
      worktreePath: deltaWs.worktreePath,
      eventCount: byWorkspace[deltaWs.id]?.count ?? 0,
    },
    live: live.map((l) => ({
      seq: l.seq,
      type: l.type,
      workspaceId: l.workspaceId,
      status: l.status,
    })),
    liveOverWs: {
      lastSeq: wsClient.getLastSeq(),
      head,
      applied: wsApplied,
      statusEvents: wsStatusEvents.map((r) => ({
        seq: r.seq,
        workspaceId: r.workspaceId,
        status: r.status,
      })),
    },
    persistence: {
      maxSeq,
      totalEvents: allRows.length,
      sessionExitedCount: allRows.filter((r) => r.type === "session.exited").length,
      byWorkspace,
      sessionsByWorkspace,
    },
  };

  // ---- Verdict ---------------------------------------------------------------
  const eachStartsRunningEndsDone = agents.every(
    (a) => a.statusOrder[0] === "running" && a.statusOrder.at(-1) === "done",
  );
  const parallelProven = maxConcurrent >= 2 && concurrencyRatio >= 1.5;
  const liveOrdered = agents.every((a) => {
    const seqs = wsStatusEvents.filter((r) => r.workspaceId === a.workspaceId);
    const running = seqs.find((r) => r.status === "running");
    const done = seqs.find((r) => r.status === "done");
    return running !== undefined && done !== undefined && running.seq < done.seq;
  });
  const wsCaughtUp = wsClient.getLastSeq() === head && head === maxSeq;
  const authOk =
    httpNoToken === 401 &&
    httpWithToken === 200 &&
    httpHostId === (host.hostId as string) &&
    wsRejectedNoToken;
  // Each agent contributes 4 workspace-attributed events (created, session.started,
  // status_changed[running], status_changed[done]); session.exited is a session
  // event (indexed by session_id, workspace_id null). 4 agents => 16 + 4 = 20.
  const sessionExitedCount = allRows.filter((r) => r.type === "session.exited").length;
  const persistedOk =
    allRows.length === 20 &&
    sessionExitedCount === 4 &&
    agents.every((a) => a.eventCount === 4) &&
    (byWorkspace[deltaWs.id]?.count ?? 0) === 4 &&
    deltaWorkspace?.status === "done";

  const pass =
    eachStartsRunningEndsDone &&
    parallelProven &&
    liveOrdered &&
    wsCaughtUp &&
    authOk &&
    manifestExisted &&
    persistedOk;

  console.log("HOST_REPORT_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("HOST_REPORT_END");
  console.log(
    `WORKER_DETAIL parallel(max=${maxConcurrent},ratio=${concurrencyRatio.toFixed(2)}) ` +
      `auth(${httpNoToken}/${httpWithToken},ws=${wsRejectedNoToken}) ` +
      `events=${allRows.length} liveOrdered=${liveOrdered} wsCaughtUp=${wsCaughtUp}`,
  );
  // Emit the verdict, then deterministically tear down + HARD-EXIT so a lingering
  // keep-alive HTTP/WS socket, node-pty pipe, or PGlite handle can never hang the
  // worker (and thus the parent spawnSync) to the 180s timeout — see worker-exit.ts.
  const code = pass ? 0 : 1;
  await finishWorker(`HOST_RESULT=${pass ? "PASS" : "FAIL"}`, code, async () => {
    await host.close();
    await store.close();
  });
  return code;
}

main().then(
  (code) => exit(code),
  (error: unknown) => {
    const reason =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.log(`HOST_RESULT=FAIL reason=${reason}`);
    exit(1);
  },
);
