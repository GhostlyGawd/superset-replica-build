import type { PtySpawnOptions, PtySupervisor, ShellKind } from "@swarm/pty-supervisor";
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
 * infer an `AgentStatus` from output activity + exit code. Zero config — a
 * command + args is enough; named presets just supply tuned `StatusDetection`.
 *
 * The supervisor spawns a *shell* and we drive the agent by writing a command
 * line into it (the same shape `pty-worker` uses), so this module only needs the
 * supervisor's TYPE — node-pty is never imported here and the bundle stays clean.
 * The supervisor itself runs under Node (ADR-0007a), so any caller wiring a real
 * PTY (tests, the host) must do so from a Node process, not Bun.
 */

/** Minimal structural view of the supervisor methods this adapter uses. */
export type PtyHost = Pick<PtySupervisor, "spawn" | "onData" | "write" | "kill">;

export interface TerminalLaunchOptions {
  readonly supervisor: PtyHost;
  readonly workspaceId: WorkspaceId;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly shell?: ShellKind;
  readonly cols?: number;
  readonly rows?: number;
  /** Extra env vars, injected on the launch line (the supervisor inherits process env). */
  readonly env?: Readonly<Record<string, string>>;
  readonly detection?: StatusDetection;
  readonly onData?: (chunk: string) => void;
  readonly onStatus?: (status: AgentStatus) => void;
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

// Carry a small tail between chunks so an exit sentinel split across two PTY
// reads is still detected, without re-matching stale prompts from far back.
const CARRY = 96;

/**
 * Launch `command` in a PTY shell and begin inferring status. Returns
 * immediately with a handle; status flows through `onStatus`. The status starts
 * at `running` (the act of launching is activity) and ends at `done`/`error`
 * once the exit sentinel is seen; quiet stretches flip it to `needs_attention`.
 */
export function launchTerminalAdapter(options: TerminalLaunchOptions): TerminalHandle {
  const detection = options.detection ?? DEFAULT_DETECTION;
  const shell = options.shell ?? defaultShell();
  const spawnOptions: PtySpawnOptions = {
    workspaceId: options.workspaceId,
    shell,
    cwd: options.cwd,
    cols: options.cols ?? 120,
    rows: options.rows ?? 30,
  };
  const session = options.supervisor.spawn(spawnOptions);

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
  options.supervisor.write(
    session.ptyId,
    `${buildLaunchLine(shell, options.command, options.args ?? [], options.env ?? {})}\r`,
  );
  armIdle();

  return {
    ptyId: session.ptyId,
    status: () => status,
    stop: async () => {
      clearIdle();
      unsubscribe();
      await options.supervisor.kill(session.ptyId);
    },
  };
}
