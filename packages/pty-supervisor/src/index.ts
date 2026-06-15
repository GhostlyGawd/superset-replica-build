import { spawn as nativeSpawn } from "@homebridge/node-pty-prebuilt-multiarch";
import type { IDisposable, IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { asId } from "@swarm/shared";
import type { PtyId, WorkspaceId } from "@swarm/shared";
import treeKill from "tree-kill";

/**
 * @swarm/pty-supervisor — PTY session registry contracts and a minimal, real
 * supervisor over node-pty (ConPTY on Windows) + tree-kill (spec §5, P05/P14).
 *
 * Runtime note (ADR-0007 validation gate, Phase 2): node-pty's Windows ConPTY
 * data pipe is driven through a net.Socket that Bun's net layer tears down
 * (ERR_SOCKET_CLOSED). The supervisor therefore runs under **Node**, as a
 * crashable child process, never inside the Bun host or Electron main directly.
 */

export const PTY_SUPERVISOR_VERSION = "0.1.0";

export const SHELL_KINDS = ["pwsh", "powershell", "cmd", "git-bash", "wsl", "bash", "zsh"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];

export interface ShellDescriptor {
  readonly kind: ShellKind;
  readonly label: string;
  readonly executable: string;
}

export interface PtySpawnOptions {
  readonly workspaceId: WorkspaceId;
  readonly shell: ShellKind;
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  /**
   * When set, spawn the shell NON-INTERACTIVELY to run this command body and exit
   * (`powershell -NonInteractive -Command <body>` / `cmd /c <body>` / `sh -c <body>`),
   * allocating a PTY for the command's own process. The body is delivered as a
   * single process argument, so on Windows no interactive prompt is opened and the
   * console line editor (PSReadLine) never re-renders or word-wraps a long launch
   * line — the GH `windows-latest` corruption that stalled agent launches. When
   * omitted, an interactive shell PTY is spawned (the supervisor probe + any caller
   * that drives the prompt by writing keystrokes).
   */
  readonly command?: string;
}

export interface PtySession {
  readonly ptyId: PtyId;
  readonly workspaceId: WorkspaceId;
  /** Shell kind for a shell PTY; absent for a directly-spawned process (spawnProcess). */
  readonly shell?: ShellKind;
  readonly cols: number;
  readonly rows: number;
}

/**
 * Options for spawning an arbitrary executable DIRECTLY in a PTY — no shell wrapper,
 * no quoting, no PSReadLine. The spawned process's stdout IS the ConPTY stream (the
 * exact pattern the supervisor's own windows-CI probe proves), so there is no
 * intermediate shell to forward a child's output. The authoritative exit (code +
 * signal) is delivered via {@link PtySupervisor.onExit} — never a printed sentinel.
 */
export interface ProcessSpawnOptions {
  readonly workspaceId: WorkspaceId;
  /** Executable image to run, or a launcher (e.g. `cmd.exe`) for a `.cmd`/`.bat` shim. */
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  /** Extra env vars, merged over the inherited process env. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A directly-spawned PTY process's exit (node-pty `onExit`) — authoritative. */
export interface PtyExit {
  /** Process exit code (0 = clean). */
  readonly exitCode: number;
  /** Terminating signal when killed by one (POSIX; not reported on Windows). */
  readonly signal?: number;
}

interface ResolvedShell {
  readonly file: string;
  readonly args: string[];
}

/**
 * Map a ShellKind to an executable + args for the current OS.
 *
 * Without `command` the shell is interactive (login / no-profile args): the caller
 * drives it by writing keystrokes into the PTY.
 *
 * With `command` the shell is invoked NON-INTERACTIVELY to run that body and exit
 * (`-NonInteractive -Command` / `/c` / `-c`). The body is passed as a single process
 * argument, so on Windows the console line editor (PSReadLine) never sees it as
 * typed input — eliminating the long-command re-render/word-wrap that corrupted
 * launches on the GH runner.
 */
export function resolveShell(kind: ShellKind, command?: string): ResolvedShell {
  const isWin = process.platform === "win32";
  const run = command !== undefined; // non-interactive: run the body and exit
  switch (kind) {
    case "pwsh":
      return {
        file: isWin ? "pwsh.exe" : "pwsh",
        args: run
          ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
          : ["-NoLogo", "-NoProfile"],
      };
    case "powershell":
      return {
        file: "powershell.exe",
        args: run
          ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
          : ["-NoLogo", "-NoProfile"],
      };
    case "cmd":
      return { file: "cmd.exe", args: run ? ["/d", "/c", command] : [] };
    case "git-bash":
      return { file: "bash.exe", args: run ? ["-c", command] : ["-l"] };
    case "wsl":
      return { file: "wsl.exe", args: run ? ["bash", "-c", command] : [] };
    case "bash":
      return { file: "bash", args: run ? ["-c", command] : ["-l"] };
    case "zsh":
      return { file: "zsh", args: run ? ["-c", command] : ["-l"] };
  }
}

interface PtyEntry {
  readonly session: PtySession;
  readonly pty: IPty;
  readonly listeners: Set<(data: string) => void>;
  readonly exitListeners: Set<(exit: PtyExit) => void>;
  /** Set once the process exits, so a late `onExit` subscriber still sees it. */
  exit: PtyExit | undefined;
  readonly disposables: IDisposable[];
}

/**
 * Owns the live PTY sessions on a host. The host is the only writer (architecture
 * §1): clients issue commands, the supervisor mutates PTYs and streams output on
 * the ephemeral terminal topic. Every session's root PID is tracked so kill() can
 * terminate the **whole process tree** (taskkill /T /F on Windows; signal-tree on
 * POSIX) rather than orphaning grandchildren (node, python, package managers).
 */
export class PtySupervisor {
  private readonly entries = new Map<PtyId, PtyEntry>();
  private counter = 0;

  /** Spawn a shell PTY and register it. Returns the session handle. */
  spawn(options: PtySpawnOptions): PtySession {
    const { file, args } = resolveShell(options.shell, options.command);
    const pty = nativeSpawn(file, args, {
      name: "xterm-color",
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: process.env,
    });
    const session: PtySession = {
      ptyId: this.nextId(),
      workspaceId: options.workspaceId,
      shell: options.shell,
      cols: options.cols,
      rows: options.rows,
    };
    this.register(session, pty);
    return session;
  }

  /**
   * Spawn an arbitrary executable DIRECTLY in a PTY (no shell wrapper) and register
   * it. The spawned process's stdout IS the ConPTY stream, and its termination is
   * surfaced via {@link onExit} with the authoritative exit code — there is no
   * printed exit sentinel to parse and no shell quoting/PSReadLine in the path. This
   * is the launch primitive for real agents (terminal adapter); shell PTYs (the
   * interactive probe + workspace lifecycle commands) still go through {@link spawn}.
   */
  spawnProcess(options: ProcessSpawnOptions): PtySession {
    const pty = nativeSpawn(options.file, [...options.args], {
      name: "xterm-color",
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    const session: PtySession = {
      ptyId: this.nextId(),
      workspaceId: options.workspaceId,
      cols: options.cols,
      rows: options.rows,
    };
    this.register(session, pty);
    return session;
  }

  private nextId(): PtyId {
    return asId<"PtyId">(`pty_${Date.now()}_${this.counter++}`);
  }

  /** Wire a freshly-spawned PTY's data + exit events and register the entry. */
  private register(session: PtySession, pty: IPty): void {
    const listeners = new Set<(data: string) => void>();
    const exitListeners = new Set<(exit: PtyExit) => void>();
    const entry: PtyEntry = {
      session,
      pty,
      listeners,
      exitListeners,
      exit: undefined,
      disposables: [],
    };
    entry.disposables.push(
      pty.onData((data: string) => {
        for (const listener of listeners) {
          listener(data);
        }
      }),
    );
    // On Windows ConPTY node-pty fires onExit on the conout socket 'close' event,
    // which is emitted only after all 'data' has been delivered — so the full output
    // stream is flushed to onData listeners before this exit fires (no lost tail).
    entry.disposables.push(
      pty.onExit(({ exitCode, signal }) => {
        entry.exit = { exitCode, signal };
        for (const listener of exitListeners) {
          listener(entry.exit);
        }
      }),
    );
    this.entries.set(session.ptyId, entry);
  }

  /** Write raw bytes/keystrokes to a PTY. */
  write(ptyId: PtyId, data: string): void {
    this.entry(ptyId).pty.write(data);
  }

  /** Subscribe to streamed output. Returns an unsubscribe function. */
  onData(ptyId: PtyId, listener: (data: string) => void): () => void {
    const entry = this.entry(ptyId);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to the process's exit (node-pty `onExit`) — the authoritative
   * done/error signal for a directly-spawned agent. If the process has already
   * exited, the listener fires immediately with the stored exit. Returns an
   * unsubscribe function.
   */
  onExit(ptyId: PtyId, listener: (exit: PtyExit) => void): () => void {
    const entry = this.entry(ptyId);
    if (entry.exit !== undefined) {
      listener(entry.exit);
      return () => {};
    }
    entry.exitListeners.add(listener);
    return () => {
      entry.exitListeners.delete(listener);
    };
  }

  /** Resize the pseudo-terminal (cols x rows). */
  resize(ptyId: PtyId, cols: number, rows: number): void {
    this.entry(ptyId).pty.resize(cols, rows);
  }

  /** Terminate the PTY's entire process tree and deregister it. Idempotent. */
  kill(ptyId: PtyId): Promise<void> {
    const entry = this.entries.get(ptyId);
    if (!entry) {
      return Promise.resolve();
    }
    const { pid } = entry.pty;
    for (const disposable of entry.disposables) {
      disposable.dispose();
    }
    entry.listeners.clear();
    entry.exitListeners.clear();
    this.entries.delete(ptyId);
    return new Promise<void>((resolve) => {
      treeKill(pid, "SIGKILL", () => resolve());
    });
  }

  /** Root OS process id for a live PTY, or undefined if unknown. */
  pidOf(ptyId: PtyId): number | undefined {
    return this.entries.get(ptyId)?.pty.pid;
  }

  /** All live sessions. */
  list(): PtySession[] {
    return [...this.entries.values()].map((entry) => entry.session);
  }

  /** Whether a PTY id is currently registered. */
  has(ptyId: PtyId): boolean {
    return this.entries.has(ptyId);
  }

  private entry(ptyId: PtyId): PtyEntry {
    const entry = this.entries.get(ptyId);
    if (!entry) {
      throw new Error(`Unknown ptyId: ${ptyId}`);
    }
    return entry;
  }
}
