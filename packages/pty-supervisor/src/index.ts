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
  readonly shell: ShellKind;
  readonly cols: number;
  readonly rows: number;
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
    const ptyId = asId<"PtyId">(`pty_${Date.now()}_${this.counter++}`);
    const session: PtySession = {
      ptyId,
      workspaceId: options.workspaceId,
      shell: options.shell,
      cols: options.cols,
      rows: options.rows,
    };
    const listeners = new Set<(data: string) => void>();
    const dataDisposable = pty.onData((data: string) => {
      for (const listener of listeners) {
        listener(data);
      }
    });
    this.entries.set(ptyId, { session, pty, listeners, disposables: [dataDisposable] });
    return session;
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
