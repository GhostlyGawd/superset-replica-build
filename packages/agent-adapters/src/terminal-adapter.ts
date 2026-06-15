import type { PtyExit, PtySupervisor, ShellKind } from "@swarm/pty-supervisor";
import type { PtyId, WorkspaceId } from "@swarm/shared";
import {
  type AgentStatus,
  DEFAULT_DETECTION,
  EXIT_SENTINEL,
  type StatusDetection,
  nextFromIdle,
  nextFromOutput,
  scanOutput,
} from "./status.ts";

/**
 * Universal terminal adapter (spec §2, P03 "universal compatibility"): launch
 * ANY CLI agent in a PTY via `@swarm/pty-supervisor`, stream its output, and
 * infer an `AgentStatus` from output activity + the process's own exit. Zero
 * config — a command + args is enough; named presets just supply tuned detection.
 *
 * The agent process is spawned DIRECTLY in the PTY (`supervisor.spawnProcess`):
 * NO shell wrapper, no quoting, no PSReadLine, no printed exit sentinel. Its stdout
 * IS the ConPTY stream — the exact pattern the supervisor's own windows-CI probe
 * proves green — so on the GH `windows-latest` runner there is no intermediate
 * shell that must forward a child's stdout (the chain that yielded zero output) and
 * no console line editor that could re-render/word-wrap a long launch line. The
 * authoritative done/error transition comes from node-pty's exit event (exit code),
 * not from parsing a `Write-Host`/`echo` sentinel out of the stream. This module
 * only needs the supervisor's TYPE — node-pty is never imported here and the bundle
 * stays clean. The supervisor runs under Node (ADR-0007a), so any caller wiring a
 * real PTY (tests, the host) must do so from a Node process, not Bun.
 *
 * (`buildExitLine`/`buildLaunchLine` below remain exported: the workspace lifecycle
 * runner in `apps/host` still composes shell command lines with an exit-sentinel
 * echo for its short `setup`/`teardown` commands — P07 — which legitimately run on
 * a shell, not as a long-lived directly-spawned agent.)
 */

/** Minimal structural view of the supervisor methods this adapter uses. */
export type PtyHost = Pick<
  PtySupervisor,
  "spawn" | "spawnProcess" | "onData" | "onExit" | "write" | "kill"
>;

export interface TerminalLaunchOptions {
  readonly supervisor: PtyHost;
  readonly workspaceId: WorkspaceId;
  /** Executable to spawn directly (an image like `node`, or a resolved CLI path). */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  /**
   * Accepted for API compatibility but unused by the direct spawn: the agent is its
   * own PTY process, with no shell. (Shell selection still matters for the workspace
   * lifecycle runner, which is a separate path.)
   */
  readonly shell?: ShellKind;
  readonly cols?: number;
  readonly rows?: number;
  /** Extra env vars, merged over process env in the spawned process. */
  readonly env?: Readonly<Record<string, string>>;
  readonly detection?: StatusDetection;
  readonly onData?: (chunk: string) => void;
  readonly onStatus?: (status: AgentStatus) => void;
  /** The process's authoritative exit (code + signal) from node-pty's exit event. */
  readonly onExit?: (exit: PtyExit) => void;
}

export interface TerminalHandle {
  readonly ptyId: PtyId;
  /** Current inferred status. */
  status(): AgentStatus;
  /** Terminate the PTY's whole process tree and stop inference. Idempotent. */
  stop(): Promise<void>;
}

/** The shell to drive when a caller does not pin one. */
export function defaultShell(): ShellKind {
  return process.platform === "win32" ? "powershell" : "bash";
}

function quotePwsh(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quoteCmd(value: string): string {
  return /[\s&|<>^"%]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Wrap an already-composed shell command `body` with optional env assignments and
 * a trailing exit-code echo so `scanOutput` can detect done/error from the PTY
 * stream (the supervisor spawns a shell, not the agent process directly, so there
 * is no process-exit event to listen on). Env quoting is per-shell so values with
 * spaces (`C:\Users\John Doe`) survive verbatim on Windows.
 *
 * `body` is emitted verbatim — pass a quoted command call (see {@link buildLaunchLine})
 * or a raw user command line (workspace `setup`/`teardown`, P07).
 */
export function buildExitLine(
  shell: ShellKind,
  body: string,
  env: Readonly<Record<string, string>> = {},
): string {
  const entries = Object.entries(env);
  switch (shell) {
    case "pwsh":
    case "powershell": {
      const envPart = entries.map(([k, v]) => `$env:${k}=${quotePwsh(v)}; `).join("");
      return `${envPart}${body}; Write-Host "${EXIT_SENTINEL}:$LASTEXITCODE"`;
    }
    case "cmd": {
      const envPart = entries.map(([k, v]) => `set ${quoteCmd(`${k}=${v}`)} & `).join("");
      return `${envPart}${body} & echo ${EXIT_SENTINEL}:%ERRORLEVEL%`;
    }
    default: {
      const envPart = entries.map(([k, v]) => `${k}=${quotePosix(v)} `).join("");
      return `${envPart}${body}; echo "${EXIT_SENTINEL}:$?"`;
    }
  }
}

/**
 * Compose the line written into the shell PTY: optional env assignments, the
 * quoted command + args, then an exit-code echo. Quoting is per-shell so paths
 * with spaces (`C:\Users\John Doe`) survive verbatim on Windows.
 */
export function buildLaunchLine(
  shell: ShellKind,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): string {
  const tokens = [command, ...args];
  switch (shell) {
    case "pwsh":
    case "powershell":
      return buildExitLine(shell, `& ${tokens.map(quotePwsh).join(" ")}`, env);
    case "cmd":
      return buildExitLine(shell, tokens.map(quoteCmd).join(" "), env);
    default:
      return buildExitLine(shell, tokens.map(quotePosix).join(" "), env);
  }
}

/**
 * Resolve the `{file, args}` actually handed to node-pty for a DIRECT spawn.
 *
 * On Windows a `.cmd`/`.bat` shim (how npm installs CLIs: `claude.cmd`, `codex.cmd`,
 * `gemini.cmd`, `cursor-agent.cmd`) is a batch SCRIPT, not an executable image, so
 * `CreateProcess` (what node-pty calls) cannot spawn it directly. Such a shim is run
 * through `cmd.exe` with the minimal, non-interactive flags `/d /s /c`:
 *   - `/d` skip any AutoRun registry command,
 *   - `/s` use standard quote handling for the quoted shim path + args,
 *   - `/c` run the command, then exit.
 * This is `cmd`, NOT powershell — there is no PSReadLine line editor, so even a long
 * absolute launch line cannot be re-rendered/word-wrapped (the windows-latest stall).
 *
 * A real `.exe` (or any executable on POSIX, and a bare name like `node` that
 * `CreateProcess` resolves on PATH) is spawned DIRECTLY: its stdout IS the ConPTY
 * stream, with no intermediate process forwarding it.
 */
export function resolveSpawnTarget(
  command: string,
  args: readonly string[],
): { readonly file: string; readonly args: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", command, ...args] };
  }
  return { file: command, args: [...args] };
}

// Carry a small tail between chunks so a multi-line prompt/error pattern split
// across two PTY reads is still detected, without re-matching stale text far back.
const CARRY = 96;

/**
 * Launch `command` DIRECTLY in a PTY (no shell) and begin inferring status. Returns
 * immediately with a handle; status flows through `onStatus`. The status starts at
 * `running` (the act of launching is activity) and ends at `done`/`error` from the
 * process's OWN exit (node-pty's exit event: exit code 0 → `done`, non-zero or a
 * signal → `error`). Quiet stretches flip it to `needs_attention`; a prompt pattern
 * in the output flips it to `needs_attention` too (both unchanged). Mid-run done
 * patterns are honored but non-terminal (a turn-based agent can resume).
 *
 * The executable is spawned via `supervisor.spawnProcess` — its stdout is the
 * ConPTY stream itself. There is no shell, no command-line quoting, no PSReadLine,
 * and no printed exit sentinel: the windows-latest "shell forwards a child's stdout
 * → zero output, then timeout" chain is eliminated by construction.
 */
export function launchTerminalAdapter(options: TerminalLaunchOptions): TerminalHandle {
  const detection = options.detection ?? DEFAULT_DETECTION;
  const target = resolveSpawnTarget(options.command, options.args ?? []);
  const session = options.supervisor.spawnProcess({
    workspaceId: options.workspaceId,
    file: target.file,
    args: target.args,
    cwd: options.cwd,
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
    env: options.env,
  });

  let status: AgentStatus = "running";
  let finished = false;
  let carry = "";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (next: AgentStatus): void => {
    if (next !== status) {
      status = next;
      options.onStatus?.(status);
    }
  };

  const clearIdle = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const armIdle = (): void => {
    clearIdle();
    if (finished) {
      return;
    }
    idleTimer = setTimeout(() => {
      emit(nextFromIdle(status, finished));
    }, detection.idleMs);
  };

  // Authoritative terminal transition: the process's own exit. node-pty flushes all
  // stdout to onData before this fires (Windows: conout socket 'close'), so the full
  // stream is observed first. exit 0 → done; non-zero or a signal → error.
  const unsubscribeExit = options.supervisor.onExit(session.ptyId, (exit) => {
    if (finished) {
      return;
    }
    finished = true;
    clearIdle();
    const terminal: AgentStatus = exit.exitCode === 0 && !exit.signal ? "done" : "error";
    options.onExit?.(exit);
    emit(terminal);
  });

  const unsubscribe = options.supervisor.onData(session.ptyId, (chunk: string) => {
    options.onData?.(chunk);
    if (finished) {
      return;
    }
    const window = carry + chunk;
    carry = window.slice(-CARRY);
    const signals = scanOutput(window, detection);
    const transition = nextFromOutput(status, finished, signals);
    finished = transition.finished;
    emit(transition.status);
    if (finished) {
      clearIdle();
    } else {
      armIdle();
    }
  });

  options.onStatus?.(status);
  armIdle();

  return {
    ptyId: session.ptyId,
    status: () => status,
    stop: async () => {
      clearIdle();
      unsubscribeExit();
      unsubscribe();
      await options.supervisor.kill(session.ptyId);
    },
  };
}
