import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorker } from "./spawn-worker.ts";

/**
 * The Phase-2 proof. node-pty cannot run under Bun on Windows (ConPTY pipe →
 * ERR_SOCKET_CLOSED, ADR-0007a), so the real host + parallel agents run in a NODE
 * child (`host-worker.ts`); Bun (the test runtime) orchestrates and adds its own
 * independent, on-disk checks. We start the REAL host (Hono + tRPC + WS sync +
 * PGlite) and spawn 4 agents — 3 mock agents in parallel programmatically (keyless
 * mock under an EXPLICIT flag) + 1 REAL `generic` adapter via the tRPC command path
 * (P03) — each isolated in its own git worktree, and assert:
 *   P02 isolation · P01 parallelism · P03 real dispatch · P04 live status ·
 *   P10 persistence · P11 auth.
 */
const WORKER = fileURLToPath(new URL("./host-worker.ts", import.meta.url));

// A space in the prefix forces every path under test to contain a space — the
// Windows "C:\\Users\\John Doe" hazard the engine must survive.
const TMP_PREFIX = join(tmpdir(), "grove host-");

interface AgentReport {
  name: string;
  branch: string;
  workspaceId: string;
  sessionId: string;
  worktreePath: string;
  fileName: string;
  outputFile: string;
  statusOrder: string[];
  runningAt: number | null;
  doneAt: number | null;
  eventCount: number;
}

interface HostReport {
  endpoint: string;
  wsUrl: string;
  port: number;
  hostId: string;
  tokenLength: number;
  manifestPath: string;
  manifestExisted: boolean;
  manifest: { endpoint: string; token: string; pid: number; startedAt: string } | null;
  auth: {
    httpNoToken: number;
    httpWithToken: number;
    httpHostId: string;
    wsRejectedNoToken: boolean;
  };
  parallel: {
    wallMs: number;
    sumMs: number;
    concurrencyRatio: number;
    maxConcurrent: number;
    agentCount: number;
  };
  agents: AgentReport[];
  delta: {
    workspaceId: string;
    sessionId: string;
    adapterId: string;
    status: string | null;
    worktreePath: string;
    eventCount: number;
  };
  live: Array<{ seq: number; type: string; workspaceId: string | null; status: string | null }>;
  liveOverWs: {
    lastSeq: number;
    head: number;
    applied: number[];
    statusEvents: Array<{ seq: number; workspaceId: string | null; status: string | null }>;
  };
  persistence: {
    maxSeq: number;
    totalEvents: number;
    sessionExitedCount: number;
    byWorkspace: Record<string, { count: number; types: string[] }>;
    sessionsByWorkspace: Record<string, Array<{ status: string; exitCode: number | null }>>;
  };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A repo on branch `main` with one commit; EOL pinned so isolation is hermetic. */
function makeFixtureRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.email", "grove@example.com");
  git(repoPath, "config", "user.name", "Grove Test");
  git(repoPath, "config", "commit.gpgsign", "false");
  git(repoPath, "config", "core.autocrlf", "false");
  writeFileSync(join(repoPath, "README.md"), "hello\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-m", "init");
}

let root: string;
let repoPath: string;
let out: string;
let exitStatus: number | null;
let report: HostReport;

beforeAll(async () => {
  root = mkdtempSync(TMP_PREFIX);
  repoPath = join(root, "repo");
  makeFixtureRepo(repoPath);

  // Bounded async spawn (see spawn-worker.ts): resolves the instant the worker
  // exits on the happy path, and tree-kills + returns rather than blocking the
  // hook to its 180s timeout if the worker ever hangs on a loaded Windows runner.
  const result = await runWorker("node", [WORKER, root], 150_000);
  out = result.out;
  exitStatus = result.status;

  const begin = out.indexOf("HOST_REPORT_BEGIN");
  const end = out.indexOf("HOST_REPORT_END");
  if (begin >= 0 && end > begin) {
    report = JSON.parse(out.slice(begin + "HOST_REPORT_BEGIN".length, end)) as HostReport;
  }
}, 180_000);

afterAll(async () => {
  if (root) {
    // Throwaway temp dir (git worktrees + PGlite data): force + retry to ride out a
    // transient Windows file lock, and SWALLOW any residual error so cleanup can
    // never fail or hang the suite.
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // best-effort: a leftover temp dir must never fail the run.
    }
  }
});

describe("@swarm/host integration — parallel isolated agents (real host, via Node)", () => {
  test("the host worker run passed end-to-end", () => {
    // Surface worker output on failure for debuggability.
    expect(out, out).toContain("HOST_RESULT=PASS");
    expect(exitStatus).toBe(0);
    expect(report).toBeDefined();
  });

  test("host exposes a loopback endpoint, bearer token + manifest (P11)", () => {
    expect(report.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(report.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/sync$/);
    expect(report.tokenLength).toBeGreaterThanOrEqual(32);
    // Manifest was written to <root>/manifest/manifest.json with the 4 fields.
    expect(report.manifestExisted).toBe(true);
    expect(report.manifest?.endpoint).toBe(report.endpoint);
    expect(report.manifest?.token.length).toBe(report.tokenLength);
    expect(typeof report.manifest?.pid).toBe("number");
    expect(typeof report.manifest?.startedAt).toBe("string");
  });

  test("auth rejects unauthenticated API + WS calls, accepts authenticated (P11)", () => {
    expect(report.auth.httpNoToken).toBe(401);
    expect(report.auth.httpWithToken).toBe(200);
    expect(report.auth.httpHostId).toBe(report.hostId);
    expect(report.auth.wsRejectedNoToken).toBe(true);
  });

  test("ISOLATION (P02): each agent's file lands only in its own worktree; base repo untouched", () => {
    expect(report.agents).toHaveLength(3);

    for (const agent of report.agents) {
      // The agent's file exists in its OWN worktree.
      expect(existsSync(agent.outputFile), `${agent.name} own file ${agent.outputFile}`).toBe(true);
      expect(readFileSync(agent.outputFile, "utf8")).toContain("Swarm mock agent run");
      // Each agent is on its own branch + working directory.
      expect(agent.branch).toBe(`grove/${agent.name}`);
    }

    // No agent's file appears in any OTHER agent's worktree (cross-absence).
    for (const owner of report.agents) {
      for (const other of report.agents) {
        if (other.workspaceId === owner.workspaceId) {
          continue;
        }
        const leaked = join(other.worktreePath, owner.fileName);
        expect(existsSync(leaked), `${owner.fileName} must be absent from ${other.name}`).toBe(
          false,
        );
      }
    }

    // The base repo working tree is pristine: on main, clean, none of the files.
    expect(git(repoPath, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(git(repoPath, "status", "--porcelain").trim()).toBe("");
    for (const agent of report.agents) {
      expect(existsSync(join(repoPath, agent.fileName))).toBe(false);
    }
  });

  test("PARALLELISM (P01): agents overlap in time, not serialized", () => {
    // At least 2 (here 3) agents were simultaneously running...
    expect(report.parallel.agentCount).toBe(3);
    expect(report.parallel.maxConcurrent).toBeGreaterThanOrEqual(2);
    // ...and the summed run time far exceeds wall-clock (serialized would be ~1.0).
    expect(report.parallel.concurrencyRatio).toBeGreaterThanOrEqual(1.5);
    expect(report.parallel.wallMs).toBeLessThan(report.parallel.sumMs);
    // Each agent transitioned running -> done.
    for (const agent of report.agents) {
      expect(agent.statusOrder[0]).toBe("running");
      expect(agent.statusOrder.at(-1)).toBe("done");
    }
  });

  test("LIVE STATUS (P04): a sync subscriber receives running→done per agent, in order", () => {
    // The live socket caught up to the durable head with no gaps.
    expect(report.liveOverWs.lastSeq).toBe(report.liveOverWs.head);
    expect(report.liveOverWs.head).toBe(report.persistence.maxSeq);
    // For every parallel agent, the running status arrived strictly before done.
    for (const agent of report.agents) {
      const events = report.liveOverWs.statusEvents.filter(
        (e) => e.workspaceId === agent.workspaceId,
      );
      const running = events.find((e) => e.status === "running");
      const done = events.find((e) => e.status === "done");
      expect(running, `${agent.name} running event`).toBeDefined();
      expect(done, `${agent.name} done event`).toBeDefined();
      expect((running?.seq ?? 0) < (done?.seq ?? 0)).toBe(true);
    }
  });

  test("PERSISTENCE (P10): events + sessions are stored in PGlite and queryable", () => {
    // 4 agents × 4 workspace-attributed events + 4 session.exited = 20.
    expect(report.persistence.totalEvents).toBe(20);
    expect(report.persistence.sessionExitedCount).toBe(4);
    for (const agent of report.agents) {
      expect(report.persistence.byWorkspace[agent.workspaceId]?.count).toBe(4);
      const sessions = report.persistence.sessionsByWorkspace[agent.workspaceId] ?? [];
      expect(sessions.some((s) => s.status === "done" && s.exitCode === 0)).toBe(true);
    }
  });

  test("tRPC COMMAND PATH (P03 real dispatch): a 4th agent via the API ran a REAL adapter", () => {
    // The API dispatched a REAL adapter, not the mock — the core P03 fix.
    expect(report.delta.adapterId).toBe("generic");
    expect(report.delta.adapterId).not.toBe("mock");
    expect(report.delta.status).toBe("done");
    expect(report.delta.eventCount).toBe(4);
    // Its file landed in its own worktree, and nowhere else.
    expect(existsSync(join(report.delta.worktreePath, "delta.md"))).toBe(true);
    for (const agent of report.agents) {
      expect(existsSync(join(agent.worktreePath, "delta.md"))).toBe(false);
    }
  });
});
