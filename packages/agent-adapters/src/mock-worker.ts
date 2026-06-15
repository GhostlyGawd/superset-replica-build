/**
 * mock-worker — runs UNDER NODE (never Bun: the PtySupervisor uses node-pty,
 * which throws ERR_SOCKET_CLOSED under Bun on Windows, ADR-0007a). Spawned by the
 * integration test, it drives the headless mock adapter through a REAL PTY:
 * spawn -> stream deterministic output -> file change -> running->done, then
 * prints a single `WORKER_RESULT=...` line plus detail the test asserts on.
 *
 * argv[2] = working dir the fake CLI writes into. argv[3] = optional ShellKind.
 */
import { readFile } from "node:fs/promises";
import { argv, cwd, exit, platform } from "node:process";
import { PtySupervisor, type ShellKind } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import type { WorkspaceId } from "@swarm/shared";
import {
  type AgentStatus,
  MOCK_FILE_HEADING,
  MOCK_OUTPUT_TOKEN,
  launchMockAgent,
} from "./index.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const workDir = argv[2] ?? cwd();
  const shell =
    (argv[3] as ShellKind | undefined) ?? (platform === "win32" ? "powershell" : "bash");

  const supervisor = new PtySupervisor();
  let buffer = "";
  const statuses: AgentStatus[] = [];

  const handle = launchMockAgent({
    supervisor,
    workspaceId: asId<"WorkspaceId">("ws_mock") as WorkspaceId,
    cwd: workDir,
    shell,
    enable: true,
    workMs: 450,
    onData: (chunk) => {
      buffer += chunk;
    },
    onStatus: (status) => {
      statuses.push(status);
    },
  });

  // Generous deadline: under a cold full-tree `turbo` run many PTY-spawning suites
  // execute concurrently, and ConPTY spawn/stream is slow under that load (ADR-0011).
  const deadline = Date.now() + 45_000;
  while (handle.status() !== "done" && handle.status() !== "error" && Date.now() < deadline) {
    await delay(100);
  }

  let fileSeen = false;
  let fileHasHeading = false;
  try {
    const content = await readFile(handle.outputFile, "utf8");
    fileSeen = true;
    fileHasHeading = content.includes(MOCK_FILE_HEADING);
  } catch {
    fileSeen = false;
  }

  await handle.stop();
  await delay(300);

  const tokenSeen = buffer.includes(MOCK_OUTPUT_TOKEN);
  const reachedDone = handle.status() === "done";
  const startedRunning = statuses[0] === "running";
  const pass = tokenSeen && reachedDone && startedRunning && fileSeen && fileHasHeading;

  // Surface the real PTY stream so the orchestrator asserts on streamed bytes,
  // not just the worker's own verdict.
  console.log("WORKER_STREAM_BEGIN");
  console.log(buffer);
  console.log("WORKER_STREAM_END");
  console.log(
    `WORKER_DETAIL shell=${shell} statuses=${statuses.join("|")} token=${tokenSeen} ` +
      `file=${fileSeen} heading=${fileHasHeading} final=${handle.status()} outputFile=${handle.outputFile}`,
  );
  console.log(`WORKER_RESULT=${pass ? "PASS" : "FAIL"}`);
  return pass ? 0 : 1;
}

main().then(
  (code) => exit(code),
  (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`WORKER_RESULT=FAIL reason=${reason}`);
    exit(1);
  },
);
