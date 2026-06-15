import type { PtyId, WorkspaceId } from "@swarm/shared";

/**
 * @swarm/pty-supervisor — PTY session registry contracts and the shells the
 * terminal hosts across operating systems (spec §5, P05/P14). node-pty runs in
 * a crashable child process; the native load gate opens Phase 2 (ADR-0007).
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
}

export interface PtySession {
  readonly ptyId: PtyId;
  readonly workspaceId: WorkspaceId;
  readonly shell: ShellKind;
  readonly cols: number;
  readonly rows: number;
}
