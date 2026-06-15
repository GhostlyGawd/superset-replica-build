/**
 * host-lifecycle-worker — runs UNDER NODE (the orchestrator drives node-pty, which
 * throws ERR_SOCKET_CLOSED under Bun on Windows, ADR-0007a). Spawned by
 * `host-lifecycle.test.ts`, it proves two things end-to-end through the real
 * {@link Orchestrator} (worktree → PTY → events → PGlite):
 *
 *   - P03 REAL dispatch: a REAL `generic` adapter (`node <fake-cli.mjs>` — no mock,
 *     no mock gate) runs in an isolated worktree on a PTY, streams events into
 *     PGlite, and reaches `done`.
 *   - P07 lifecycle: the workspace `setup` commands EXECUTE to completion BEFORE the
 *     agent launches (a marker file exists + setup events precede `session.started`),
 *     and `teardown` runs AFTER the session ends (marker + events follow
 *     `session.exited`), with the workspace env vars injected.
 *
 * argv[2] = temp root dir containing repo/ (with .grove/config.json) + pg/ + worktrees/.
 * Emits HOST_REPORT_BEGIN/END JSON + a WORKER_RESULT line the bun test parses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fakeCliPath } from "@swarm/agent-adapters";
import type { DomainEvent } from "@swarm/core-engine";
import { openStore } from "@swarm/db/store";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { Orchestrator } from "./orchestrator.ts";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { finishWorker } from "./worker-exit.ts";

interface Rec {
  readonly seq: number;
  readonly type: string;
  readonly phase: string | null;
}

function phaseOf(event: DomainEvent): string | null {
  return event.type === "workspace.lifecycle" ? event.phase : null;
}

async function main(): Promise<number> {
  // Startup breadcrumb on stdout BEFORE anything can throw: proves the worker
  // booted at all. Combined with the all-paths-emit guard below (every exit goes
  // through finishWorker, which flushes stdout before exiting), the parent can
  // never again observe truly EMPTY output — a crash now surfaces a reason+stack.
  stdout.write("WORKER_BOOT lifecycle\n");

  // Best-effort teardown, upgraded once the orchestrator/store exist so the catch
  // below can always hand finishWorker a cleanup that is safe to call.
  let cleanup: () => Promise<void> = async () => {};

  try {
    const rootDir = argv[2];
    if (!rootDir) {
      await finishWorker("WORKER_RESULT=FAIL reason=no-root-dir", 1, cleanup);
      return 1;
    }
    const repoRoot = join(rootDir, "repo");
    const pgDir = join(rootDir, "pg");
    const worktreesDir = join(rootDir, "worktrees");

    const store = await openStore({ dataDir: pgDir });
    const hostId = asId<"HostId">("grove-host-lifecycle");
    const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
    const supervisor = new PtySupervisor();
    const orchestrator = new Orchestrator({
      store,
      eventLog,
      supervisor,
      worktreesRoot: worktreesDir,
    });
    cleanup = async () => {
      await orchestrator.shutdown();
      await store.close();
    };

    const recs: Rec[] = [];
    const unsubscribe = eventLog.subscribe((stored) => {
      recs.push({ seq: stored.seq, type: stored.event.type, phase: phaseOf(stored.event) });
    });

    const project = await store.createProject({
      name: "fixture",
      localPath: repoRoot,
      defaultBranch: "main",
    });
    const prepared = await orchestrator.createWorkspace({
      project,
      name: "agent-cfg",
      branch: "grove/agent-cfg",
      baseBranch: "main",
      worktreesDir,
    });

    // REAL `generic` adapter: run the fake CLI as a plain node script — NOT the mock,
    // and with no mock gate set anywhere in this process.
    const run = await orchestrator.startAgent(prepared, {
      adapterId: "generic",
      command: "node",
      args: [fakeCliPath(), "--file", "out.md", "--work-ms", "300"],
    });
    const result = await run.done; // resolves only after teardown completes (P07)
    await run.stop();
    unsubscribe();

    const worktree = prepared.worktreePathOs;
    const setupMarker = join(worktree, "SETUP_RAN.txt");
    const teardownMarker = join(worktree, "TEARDOWN_RAN.txt");
    const setupMarkerExists = existsSync(setupMarker);
    const setupMarkerContent = setupMarkerExists ? readFileSync(setupMarker, "utf8").trim() : "";
    const teardownMarkerExists = existsSync(teardownMarker);
    const outFileExists = existsSync(join(worktree, "out.md"));

    const seqsWhere = (pred: (r: Rec) => boolean): number[] => recs.filter(pred).map((r) => r.seq);
    const setupSeqs = seqsWhere((r) => r.type === "workspace.lifecycle" && r.phase === "setup");
    const teardownSeqs = seqsWhere(
      (r) => r.type === "workspace.lifecycle" && r.phase === "teardown",
    );
    const startedSeq = recs.find((r) => r.type === "session.started")?.seq ?? -1;
    const exitedSeq = recs.find((r) => r.type === "session.exited")?.seq ?? -1;
    const setupBeforeAgent = setupSeqs.length > 0 && Math.max(...setupSeqs) < startedSeq;
    const teardownAfterAgent =
      teardownSeqs.length > 0 && exitedSeq > 0 && Math.min(...teardownSeqs) > exitedSeq;

    // Independent persistence check straight from PGlite.
    const rows = await store.readEventsFromSeq(0, { hostId });
    const persistedLifecycle = rows.filter((r) => r.type === "workspace.lifecycle").length;
    const session = await store.getSession(run.session.id);

    const report = {
      adapterId: run.adapterId,
      sessionAdapterId: session?.adapterId ?? null,
      workspaceName: prepared.workspace.name,
      finalStatus: result.status,
      exitCode: result.exitCode,
      outFileExists,
      setupMarkerExists,
      setupMarkerContent,
      teardownMarkerExists,
      setupSeqs,
      teardownSeqs,
      startedSeq,
      exitedSeq,
      setupBeforeAgent,
      teardownAfterAgent,
      persistedLifecycle,
      totalEvents: rows.length,
    };

    const pass =
      run.adapterId === "generic" &&
      session?.adapterId === "generic" &&
      result.status === "done" &&
      outFileExists &&
      setupMarkerExists &&
      setupMarkerContent === prepared.workspace.name &&
      teardownMarkerExists &&
      setupBeforeAgent &&
      teardownAfterAgent &&
      persistedLifecycle >= 4;

    console.log("HOST_REPORT_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("HOST_REPORT_END");
    console.log(
      `WORKER_DETAIL adapter=${run.adapterId} final=${result.status} ` +
        `setupBeforeAgent=${setupBeforeAgent} teardownAfterAgent=${teardownAfterAgent} ` +
        `markers(setup=${setupMarkerExists},teardown=${teardownMarkerExists}) persisted=${persistedLifecycle}`,
    );
    // Emit the verdict, then deterministically tear down + HARD-EXIT so a lingering
    // node-pty pipe or PGlite handle can never hang the worker (and thus the parent
    // spawnSync) to the 180s timeout — see worker-exit.ts.
    const code = pass ? 0 : 1;
    await finishWorker(`WORKER_RESULT=${pass ? "PASS" : "FAIL"}`, code, cleanup);
    return code;
  } catch (error) {
    // ANY throw on the way to the verdict (config load, worktree, PTY/child spawn,
    // PGlite) lands here and STILL emits a verdict — with the reason + stack — via
    // finishWorker (flush-then-exit), so the suite shows the real cause, never "".
    const reason =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    await finishWorker(`WORKER_RESULT=FAIL reason=${reason}`, 1, cleanup);
    return 1;
  }
}

main().then(
  (code) => exit(code),
  (error: unknown) => {
    // Last-ditch net: main() already routes every path through finishWorker, but if
    // something escapes, flush the failure line BEFORE exiting (the callback fires
    // once the pipe drains) so the parent never sees empty output.
    const reason =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    stdout.write(`WORKER_RESULT=FAIL reason=${reason}\n`, () => exit(1));
  },
);
