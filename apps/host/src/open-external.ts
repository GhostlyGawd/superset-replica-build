import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolveExecutable } from "@swarm/agent-adapters";

/**
 * Open-in-external (P08): open a workspace's on-disk worktree on the HOST — the
 * machine where the worktree physically lives — cross-platform via
 * `child_process` (never a PTY). Three targets:
 *   - `editor`   → `$VISUAL`/`$EDITOR`, else `code`/`cursor` if present;
 *   - `terminal` → Windows Terminal/`cmd`, macOS `Terminal.app`, Linux
 *                  `$TERMINAL`/`x-terminal-emulator`/common emulators;
 *   - `folder`   → reveal in the OS file manager (`explorer`/`open`/`xdg-open`).
 *
 * Binaries are resolved defensively (where.exe/which, PATHEXT-aware) rather than
 * assuming PATH or a hardcoded location (spec §5). Launches are detached so the
 * host process never blocks on, or is killed alongside, the opened app.
 */
export type ExternalTarget = "editor" | "terminal" | "folder";

/** A concrete thing to launch: the resolved binary, its args, and a working dir. */
export interface LaunchSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/**
 * E2E seam (NOT a user-path mock): when this env var names a file, `openExternal`
 * records the launch it WOULD perform (one JSON line) instead of spawning, and
 * does so without requiring the target binary to be installed. On the real user
 * path (env unset) it resolves a genuine binary and spawns it. This lets the
 * Playwright suite assert the right command/target/path on a headless runner that
 * has no GUI editor or terminal installed.
 */
export const EXTERNAL_LAUNCH_CAPTURE_ENV = "GROVE_EXTERNAL_LAUNCH_CAPTURE";

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Candidate launch specs for a target, in preference order, per platform. */
function candidatesFor(target: ExternalTarget, worktreePath: string): LaunchSpec[] {
  const platform = process.platform;
  if (target === "editor") {
    const named = [process.env.VISUAL, process.env.EDITOR, "code", "cursor"].filter(nonEmpty);
    return named.map((command) => ({ command, args: [worktreePath] }));
  }
  if (target === "terminal") {
    if (platform === "win32") {
      return [
        { command: "wt.exe", args: ["-d", worktreePath] },
        // `start` opens a fresh console whose cwd is the worktree; `/K` keeps it open.
        { command: "cmd.exe", args: ["/c", "start", "", "cmd", "/K"], cwd: worktreePath },
      ];
    }
    if (platform === "darwin") {
      return [{ command: "open", args: ["-a", "Terminal", worktreePath] }];
    }
    const named = [
      process.env.TERMINAL,
      "x-terminal-emulator",
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "xterm",
    ].filter(nonEmpty);
    return named.map((command) => ({ command, args: [], cwd: worktreePath }));
  }
  // folder
  if (platform === "win32") {
    return [{ command: "explorer.exe", args: [worktreePath] }];
  }
  if (platform === "darwin") {
    return [{ command: "open", args: [worktreePath] }];
  }
  return [{ command: "xdg-open", args: [worktreePath] }];
}

/**
 * Resolve the first candidate whose binary actually exists, swapping in its
 * absolute path. With `mustExist:false` (capture mode) the first candidate is
 * returned as-is (resolved if possible, for fidelity) so recording never depends
 * on a binary being installed.
 */
async function resolveLaunch(
  target: ExternalTarget,
  worktreePath: string,
  mustExist: boolean,
): Promise<LaunchSpec> {
  const candidates = candidatesFor(target, worktreePath);
  for (const candidate of candidates) {
    const resolved = await resolveExecutable(candidate.command);
    if (resolved) {
      return { ...candidate, command: resolved };
    }
  }
  if (mustExist) {
    const tried = candidates.map((c) => c.command).join(", ") || "none";
    const hint =
      target === "editor"
        ? "Install VS Code (`code`)/Cursor or set $VISUAL/$EDITOR."
        : "Install the platform default or set the relevant launcher.";
    throw new Error(`no ${target} launcher found on this host (tried: ${tried}). ${hint}`);
  }
  const fallback = candidates[0];
  if (!fallback) {
    throw new Error(`no ${target} launch candidates for this platform`);
  }
  return fallback;
}

/** Spawn a resolved launch detached so the host neither blocks nor owns the app. */
function spawnLaunch(spec: LaunchSpec): void {
  // On Windows, `.cmd`/`.bat` shims (e.g. `code.cmd`) cannot be CreateProcess'd
  // directly — route them through the command processor.
  const isWindowsShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.command);
  const command = isWindowsShim ? (process.env.ComSpec ?? "cmd.exe") : spec.command;
  const args = isWindowsShim ? ["/c", spec.command, ...spec.args] : [...spec.args];
  const child = spawn(command, args, {
    cwd: spec.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.on("error", () => {
    // Best-effort: a launch failure must never crash the host. The renderer learns
    // of a hard failure only when resolution threw above; a post-spawn error here
    // (e.g. the app refused to start) is surfaced via the OS, not the API.
  });
  child.unref();
}

/**
 * Open the worktree at `worktreePath` with the given external target on this host.
 * Throws (→ a tRPC error) only when no suitable launcher can be resolved.
 */
export async function openExternal(target: ExternalTarget, worktreePath: string): Promise<void> {
  const captureFile = process.env[EXTERNAL_LAUNCH_CAPTURE_ENV];
  const spec = await resolveLaunch(target, worktreePath, !nonEmpty(captureFile));
  if (nonEmpty(captureFile)) {
    appendFileSync(
      captureFile,
      `${JSON.stringify({ target, command: spec.command, args: spec.args, path: worktreePath })}\n`,
      "utf8",
    );
    return;
  }
  spawnLaunch(spec);
}
