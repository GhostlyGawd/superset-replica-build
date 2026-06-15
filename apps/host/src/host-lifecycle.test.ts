import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWorker } from "./spawn-worker.ts";

/**
 * P03 (real adapter dispatch) + P07 (workspace setup/teardown) proof. node-pty
 * cannot run under Bun on Windows (ADR-0007a), so the real orchestrator runs in a
 * NODE child (`host-lifecycle-worker.ts`) and Bun (the test runtime) sets up the
 * fixture + asserts the JSON report. The worker dispatches a REAL `generic` adapter
 * (not the mock) and the project carries a `.grove/config.json` whose `setup` writes
 * a marker before the agent and whose `teardown` writes one after it.
 */
const WORKER = fileURLToPath(new URL("./host-lifecycle-worker.ts", import.meta.url));

// A space in the prefix forces every path to contain a space (the Windows
// "C:\\Users\\John Doe" hazard).
const TMP_PREFIX = join(tmpdir(), "grove lifecycle-");

// `node -e` runs identically under pwsh (Windows default shell) and bash/sh (POSIX);
// the env var is injected by the lifecycle runner, proving SWARM_WORKSPACE_NAME wiring.
const WRITE_NAME =
  "node -e \"require('fs').writeFileSync('SETUP_RAN.txt', String(process.env.SWARM_WORKSPACE_NAME))\"";
const WRITE_TEARDOWN = "node -e \"require('fs').writeFileSync('TEARDOWN_RAN.txt','ok')\"";

const CONFIG = {
  setup: [WRITE_NAME],
  // The per-OS object form exercises PlatformCommand resolution on every runner.
  teardown: [{ windows: WRITE_TEARDOWN, posix: WRITE_TEARDOWN }],
};

interface Report {
  adapterId: string;
  sessionAdapterId: string | null;
  workspaceName: string;
  finalStatus: string;
  exitCode: number;
  outFileExists: boolean;
  setupMarkerExists: boolean;
  setupMarkerContent: string;
  teardownMarkerExists: boolean;
  setupSeqs: number[];
  teardownSeqs: number[];
  startedSeq: number;
  exitedSeq: number;
  setupBeforeAgent: boolean;
  teardownAfterAgent: boolean;
  persistedLifecycle: number;
  totalEvents: number;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

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
  // The workspace config the orchestrator loads + executes (read from repo root).
  mkdirSync(join(repoPath, ".grove"), { recursive: true });
  writeFileSync(join(repoPath, ".grove", "config.json"), `${JSON.stringify(CONFIG, null, 2)}\n`);
}

let root: string;
let out: string;
let exitStatus: number | null;
let report: Report;

beforeAll(async () => {
  root = mkdtempSync(TMP_PREFIX);
  makeFixtureRepo(join(root, "repo"));

  // Bounded async spawn (see spawn-worker.ts): resolves as soon as the worker
  // exits, and tree-kills + returns rather than blocking the hook to its 180s
  // timeout if the worker ever hangs on a loaded Windows runner.
  const result = await runWorker("node", [WORKER, root], 150_000);
  out = result.out;
  exitStatus = result.status;

  const begin = out.indexOf("HOST_REPORT_BEGIN");
  const end = out.indexOf("HOST_REPORT_END");
  if (begin >= 0 && end > begin) {
    report = JSON.parse(out.slice(begin + "HOST_REPORT_BEGIN".length, end)) as Report;
  }

  // The worker already read every marker into the report above; the temp dir
  // (git worktrees + PGlite data) is throwaway. Force + retry to ride out a
  // transient Windows file lock, and SWALLOW any residual error so cleanup can
  // never fail or hang the suite.
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // best-effort: a leftover temp dir must never fail the run.
  }
}, 180_000);

describe("@swarm/host — real adapter dispatch + workspace lifecycle (real orchestrator, via Node)", () => {
  test("the lifecycle worker run passed end-to-end", () => {
    expect(out, out).toContain("WORKER_RESULT=PASS");
    expect(exitStatus).toBe(0);
    expect(report).toBeDefined();
  });

  test("P03: the API dispatched a REAL `generic` adapter (not the mock) to `done`", () => {
    expect(report.adapterId).toBe("generic");
    expect(report.sessionAdapterId).toBe("generic");
    expect(report.finalStatus).toBe("done");
    expect(report.exitCode).toBe(0);
    // The real adapter actually ran a CLI that wrote a file in its worktree.
    expect(report.outFileExists).toBe(true);
    // Its lifecycle + status events were persisted to PGlite.
    expect(report.persistedLifecycle).toBeGreaterThanOrEqual(4);
  });

  test("P07: `setup` executed BEFORE the agent started", () => {
    expect(report.setupMarkerExists).toBe(true);
    // The marker's content is the injected SWARM_WORKSPACE_NAME env var.
    expect(report.setupMarkerContent).toBe(report.workspaceName);
    // Every setup event has a lower seq than session.started.
    expect(report.setupSeqs.length).toBeGreaterThan(0);
    expect(report.setupBeforeAgent).toBe(true);
    expect(Math.max(...report.setupSeqs)).toBeLessThan(report.startedSeq);
  });

  test("P07: `teardown` executed AFTER the session ended", () => {
    expect(report.teardownMarkerExists).toBe(true);
    expect(report.teardownSeqs.length).toBeGreaterThan(0);
    expect(report.teardownAfterAgent).toBe(true);
    expect(Math.min(...report.teardownSeqs)).toBeGreaterThan(report.exitedSeq);
  });
});
