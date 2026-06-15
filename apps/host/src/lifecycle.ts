import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DETECTION,
  type PtyHost,
  buildExitLine,
  defaultShell,
  scanOutput,
} from "@swarm/agent-adapters";
import { type Command, ENV_VARS, type Shell, type SwarmConfig, parseConfig } from "@swarm/config";
import type { DomainEvent } from "@swarm/core-engine";
import type { ShellKind } from "@swarm/pty-supervisor";
import type { WorkspaceId } from "@swarm/shared";

/**
 * Workspace lifecycle (P07): load a project's `.grove/config.json` and EXECUTE its
 * `setup` commands before an agent launches and `teardown` after the session ends.
 * Commands are real cross-platform shell lines (a bare string runs on each OS's
 * default shell; a `{ windows, posix }` object picks a per-OS line + shell), run on
 * the PTY/shell layer with the workspace env vars injected (architecture §2, §5,
 * ADR-0004). Their output is streamed as bounded `workspace.lifecycle` events.
 */

/** Committed workspace config path, relative to a project repo root. */
export const GROVE_CONFIG_PATH = join(".grove", "config.json");

/** Largest output tail carried in a lifecycle event (keeps the durable log lean). */
const OUTPUT_TAIL = 2_000;
const CARRY = 96;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

type OsFamily = "windows" | "posix";

function osFamily(): OsFamily {
  return process.platform === "win32" ? "windows" : "posix";
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

/** Map a config {@link Shell} to a PTY {@link ShellKind} (default = OS default shell). */
function toShellKind(shell: Shell | undefined): ShellKind {
  switch (shell) {
    case undefined:
      return defaultShell();
    case "sh":
      return "bash";
    default:
      return shell;
  }
}

interface RunResult {
  readonly exitCode: number;
  readonly output: string;
}

/**
 * Run a raw shell command line to completion on a PTY, streaming its output and
 * resolving with the exit code derived from the appended exit sentinel (the shell
 * is what we spawn, so the code surfaces in the stream, not a process event).
 *
 * The command (env assignments + the user line + exit-sentinel echo) is run
 * NON-INTERACTIVELY as the shell's own `-Command`/`-c`/`/c` argument — never typed
 * into an interactive prompt — so a long line never hits the Windows PSReadLine
 * line editor (the GH-runner re-render/word-wrap corruption that stalls launches).
 */
function runShellLine(
  supervisor: PtyHost,
  opts: {
    readonly workspaceId: WorkspaceId;
    readonly cwd: string;
    readonly shell: ShellKind;
    readonly line: string;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
    readonly onData?: (chunk: string) => void;
  },
): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const session = supervisor.spawn({
      workspaceId: opts.workspaceId,
      shell: opts.shell,
      cwd: opts.cwd,
      cols: 120,
      rows: 30,
      command: buildExitLine(opts.shell, opts.line, opts.env),
    });
    let carry = "";
    let captured = "";
    let settled = false;
    let unsubscribe: () => void = () => {};
    const finish = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      void supervisor.kill(session.ptyId).then(() => {
        resolve({ exitCode, output: captured.slice(-OUTPUT_TAIL) });
      });
    };
    const timer = setTimeout(() => finish(124), opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    unsubscribe = supervisor.onData(session.ptyId, (chunk) => {
      opts.onData?.(chunk);
      captured += chunk;
      const window = carry + chunk;
      carry = window.slice(-CARRY);
      const signals = scanOutput(window, DEFAULT_DETECTION);
      if (signals.sawExit) {
        finish(signals.exitCode ?? 0);
      }
    });
    // The command runs as the shell's own argument (spawn `command` above); no
    // interactive write, so the Windows line editor never mangles a long line.
  });
}

export interface LifecyclePhaseOptions {
  readonly supervisor: PtyHost;
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
    const shell = toShellKind(resolved.shell);
    await options.append({
      type: "workspace.lifecycle",
      workspaceId: options.workspaceId,
      phase: options.phase,
      status: "running",
      command: resolved.run,
    });
    const result = await runShellLine(options.supervisor, {
      workspaceId: options.workspaceId,
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
