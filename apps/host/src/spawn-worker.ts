/**
 * Bounded worker spawn for the host test suites (`host-integration.test.ts` /
 * `host-lifecycle.test.ts`). Both run the real engine in a spawned Node child and
 * the bun lifecycle hook must NEVER hang waiting on it.
 *
 * `spawnSync` is the wrong tool here: it blocks the bun thread until the child's
 * stdio pipe reaches EOF, and on Windows its `timeout` does NOT tree-kill — a
 * lingering node-pty/ConPTY grandchild keeps the pipe's write end open, so the
 * synchronous read never returns and the hook runs to its own 180s timeout. This
 * helper instead drives an async {@link spawn}: on the happy path it resolves the
 * instant the worker process closes; if the worker overruns `timeoutMs` it
 * TREE-kills the child and every descendant (taskkill /T /F on Windows so no
 * grandchild keeps a handle or pipe alive), then resolves with whatever output was
 * captured — bounded by construction, never awaiting a hung child indefinitely.
 */
import { spawn, spawnSync } from "node:child_process";

export interface WorkerOutcome {
  /** Combined stdout + stderr, parsed by the caller for the JSON report markers. */
  readonly out: string;
  /** Exit code from the worker process, or null if it was killed / never exited. */
  readonly status: number | null;
}

/** Tree-kill a process and all of its descendants. Best-effort; never throws. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      // /t = whole tree, /f = force; frees node-pty/git/PGlite handles the child held.
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // The process may already be gone; killing is best-effort.
  }
}

/**
 * Run `command args` as a Node test worker and return its combined output + exit
 * code, bounded by `timeoutMs` so the spawning bun hook can never hang past it.
 */
export function runWorker(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<WorkerOutcome> {
  return new Promise<WorkerOutcome>((resolve) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let status: number | null = null;
    let settled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      out += chunk;
    });

    const settle = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ out, status });
    };

    // Don't await a hung worker: tree-kill it (so a lingering node-pty pipe can't
    // hold the read open) and resolve regardless a moment later.
    const timer = setTimeout(() => {
      killTree(child.pid);
      setTimeout(settle, 1000);
    }, timeoutMs);

    child.on("exit", (code) => {
      status = code;
    });
    child.on("close", settle);
    child.on("error", settle);
  });
}
