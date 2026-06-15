import { type ChildProcess, type StdioOptions, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Command, ENV_VARS, type Shell, type SwarmConfig, parseConfig } from "@swarm/config";
import type { DomainEvent } from "@swarm/core-engine";
import type { WorkspaceId } from "@swarm/shared";

/**
 * Workspace lifecycle (P07): load a project's `.grove/config.json` and EXECUTE its
 * `setup` commands before an agent launches and `teardown` after the session ends.
 * Commands are real cross-platform shell lines (a bare string runs on each OS's
 * default shell; a `{ windows, posix }` object picks a per-OS line + shell) with the
 * workspace env vars injected (architecture §2, §5, ADR-0004). Their output is
 * streamed as bounded `workspace.lifecycle` events.
 *
 * These are batch setup/teardown commands — they need no TTY — so each runs through
 * plain `node:child_process` `spawn` on a NON-interactive per-OS shell
 * (`cmd.exe /d /s /c "<line>"` on Windows, `sh -c "<line>"` on POSIX), with stdio
 * piped and the exit code taken from the child's `close` event. This deliberately
 * avoids the PTY/ConPTY + exit-sentinel path the agent launch uses: a ConPTY child
 * was the windows-latest stall, and a batch command gains nothing from a TTY.
 */

/** Committed workspace config path, relative to a project repo root. */
export const GROVE_CONFIG_PATH = join(".grove", "config.json");

/** Largest output tail carried in a lifecycle event (keeps the durable log lean). */
const OUTPUT_TAIL = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

/** Non-interactive PowerShell flags: run the body and exit, no profile, no prompt. */
const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] as const;

/** Pipe stdout + stderr, ignore stdin (a batch command reads nothing). */
const STDIO: StdioOptions = ["ignore", "pipe", "pipe"];

type OsFamily = "windows" | "posix";

function osFamily(): OsFamily {
  return process.platform === "win32" ? "windows" : "posix";
}

/** The OS's default shell when a command pins none. */
function defaultShell(): Shell {
  return process.platform === "win32" ? "cmd" : "sh";
}

/**
 * Load + validate `<repoRoot>/.grove/config.json`. Returns `null` when the file is
 * absent (the common case — no config means no lifecycle commands). Throws with a
 * pinpointed message on malformed JSON or a schema violation, so a broken config is
 * surfaced rather than silently skipped.
 */
export function loadWorkspaceConfig(repoRoot: string): SwarmConfig | null {
  const file = join(repoRoot, GROVE_CONFIG_PATH);
  if (!existsSync(file)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid JSON in ${file}: ${(error as Error).message}`);
  }
  const parsed = parseConfig(raw);
  if (!parsed.ok) {
    throw new Error(
      `invalid workspace config ${file} at "${parsed.error.path}": ${parsed.error.message}`,
    );
  }
  return parsed.value;
}

/** Resolve one config command for this OS family; `null` ⇒ not applicable here. */
export function resolveCommand(
  command: Command,
  family: OsFamily = osFamily(),
): { run: string; shell?: Shell } | null {
  if (typeof command === "string") {
    return { run: command };
  }
  const branch = family === "windows" ? command.windows : command.posix;
  if (branch === undefined) {
    return null;
  }
  return typeof branch === "string" ? { run: branch } : { run: branch.run, shell: branch.shell };
}

/** Tree-kill a process and all of its descendants. Best-effort; never throws. */
function killChildTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      // /t = whole tree, /f = force; frees any grandchild (node/git) the shell spawned.
      spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // The process may already be gone; killing is best-effort.
  }
}

/**
 * Spawn one lifecycle command line on a NON-interactive shell — no PTY. The shell is
 * the OS default (`cmd` on Windows, `sh` on POSIX) unless the command pins one. On
 * Windows the line is handed to `cmd.exe /d /s /c "<line>"` VERBATIM so cmd (not
 * Node's CommandLineToArgvW escaper) parses it — `/s` strips the wrapping quotes and
 * runs the remainder as-is. Env vars are injected via the spawn `env` option (no
 * shell `set`/`$env:` prelude), inherited by any grandchild the shell launches.
 */
function spawnLifecycleCommand(
  shell: Shell,
  line: string,
  cwd: string,
  extraEnv: Readonly<Record<string, string>>,
): ChildProcess {
  const options = {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: STDIO,
    windowsHide: true,
  };
  switch (shell) {
    case "cmd":
      return spawn("cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
        ...options,
        windowsVerbatimArguments: true,
      });
    case "pwsh":
      return spawn(
        process.platform === "win32" ? "pwsh.exe" : "pwsh",
        [...POWERSHELL_ARGS, line],
        options,
      );
    case "powershell":
      return spawn("powershell.exe", [...POWERSHELL_ARGS, line], options);
    case "wsl":
      return spawn("wsl.exe", ["bash", "-c", line], options);
    default:
      // bash | sh | zsh — the body is a single `-c` argument (Node escapes it for
      // the standard Windows/POSIX arg parser these shells use).
      return spawn(shell, ["-c", line], options);
  }
}

interface RunResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Run one shell command line to completion via `node:child_process`, capturing
 * stdout + stderr and resolving on the child's `close` event with its real exit
 * code. Bounded by `timeoutMs`: an overrunning command is tree-killed and reported
 * as a timeout (124) so a lifecycle phase can never hang the worker.
 */
function runCommandLine(opts: {
  readonly cwd: string;
  readonly shell: Shell;
  readonly line: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly onData?: (chunk: string) => void;
}): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const child = spawnLifecycleCommand(opts.shell, opts.line, opts.cwd, opts.env);
    let captured = "";
    let settled = false;
    const onChunk = (chunk: string): void => {
      opts.onData?.(chunk);
      captured += chunk;
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    const finish = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, output: captured.slice(-OUTPUT_TAIL) });
    };
    const timer = setTimeout(() => {
      killChildTree(child.pid);
      finish(124);
    }, opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

    child.once("close", (code, signal) => finish(code ?? (signal != null ? 1 : 0)));
    child.once("error", (error) => {
      onChunk(`lifecycle command failed to spawn: ${(error as Error).message}\n`);
      finish(127);
    });
  });
}

export interface LifecyclePhaseOptions {
  readonly workspaceId: WorkspaceId;
  /** Worktree (OS-native path) the commands run in. */
  readonly cwd: string;
  /** Project repo root, injected as `SWARM_ROOT_PATH`. */
  readonly repoRoot: string;
  readonly workspaceName: string;
  readonly phase: "setup" | "teardown";
  readonly commands: readonly Command[];
  /** Append a domain event (the orchestrator wires this to the durable event log). */
  readonly append: (event: DomainEvent) => Promise<unknown>;
  readonly onData?: (chunk: string) => void;
  readonly timeoutMs?: number;
}

/**
 * Execute one lifecycle phase end-to-end. Each command emits a `running`
 * `workspace.lifecycle` event when it begins and a `done`/`error` event (with exit
 * code + a bounded output tail) when it finishes. `setup` stops on the first
 * failure; `teardown` is best-effort and runs every command. Returns whether all
 * applicable commands succeeded.
 */
export async function runLifecyclePhase(options: LifecyclePhaseOptions): Promise<{ ok: boolean }> {
  if (options.commands.length === 0) {
    return { ok: true };
  }
  const env: Record<string, string> = {
    [ENV_VARS.rootPath]: options.repoRoot,
    [ENV_VARS.workspaceName]: options.workspaceName,
    [ENV_VARS.workspacePath]: options.cwd,
  };
  let ok = true;
  for (const command of options.commands) {
    const resolved = resolveCommand(command);
    if (resolved === null) {
      continue; // command not applicable on this OS family
    }
    const shell = resolved.shell ?? defaultShell();
    await options.append({
      type: "workspace.lifecycle",
      workspaceId: options.workspaceId,
      phase: options.phase,
      status: "running",
      command: resolved.run,
    });
    const result = await runCommandLine({
      cwd: options.cwd,
      shell,
      line: resolved.run,
      env,
      timeoutMs: options.timeoutMs,
      onData: options.onData,
    });
    const status = result.exitCode === 0 ? "done" : "error";
    if (status === "error") {
      ok = false;
    }
    await options.append({
      type: "workspace.lifecycle",
      workspaceId: options.workspaceId,
      phase: options.phase,
      status,
      command: resolved.run,
      exitCode: result.exitCode,
      output: result.output,
    });
    if (status === "error" && options.phase === "setup") {
      break; // do not launch the agent against a half-prepared workspace
    }
  }
  return { ok };
}
