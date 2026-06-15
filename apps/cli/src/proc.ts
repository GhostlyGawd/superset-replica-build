import { spawnSync } from "node:child_process";

/**
 * Cross-platform process primitives shared by the daemon lifecycle (W1) and the
 * remote tunnel manager (W3). Extracted so both reuse ONE tree-kill (ADR-0011 /
 * ADR-0017) — no duplicated platform branching.
 */

/**
 * Cross-platform "is this PID alive?". Signal `0` probes a process without
 * delivering a signal: it throws `ESRCH` when the PID is gone and `EPERM` when the
 * process exists but is owned by another user (⇒ alive).
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Terminate a process TREE by PID (ADR-0011). On Windows there is no deliverable
 * graceful signal for a windowless detached process, so `taskkill /T` (whole tree)
 * is used — without `/F` for the graceful pass, with `/F` to force. On POSIX a
 * negative PID delivers the signal to the WHOLE group (the process + every child it
 * spawned), with a single-PID fallback when the group is already gone. Best-effort:
 * a PID that is already dead is silently ignored.
 */
export function treeKill(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") {
      args.push("/f");
    }
    spawnSync("taskkill", args, { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone — killing is best-effort.
    }
  }
}
