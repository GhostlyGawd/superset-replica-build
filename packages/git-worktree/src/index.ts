import type { ChangeType } from "@swarm/db";
import type { WorkspaceId } from "@swarm/shared";

/**
 * @swarm/git-worktree — worktree/branch refs and the diff/status shapes the
 * engine and diff viewer share (spec §2, P02/P06). Git invocation lands in
 * Phase 2; these contracts are stable from Phase 0.
 */

export const GIT_WORKTREE_VERSION = "0.1.0";

export interface WorktreeRef {
  readonly workspaceId: WorkspaceId;
  readonly branch: string;
  readonly baseBranch: string;
  /** POSIX-normalized worktree path (spec §5); converted at the OS boundary. */
  readonly path: string;
}

export interface FileChange {
  readonly path: string;
  readonly changeType: ChangeType;
  readonly additions: number;
  readonly deletions: number;
}

export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

export interface FileDiff {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly oldText: string;
  readonly newText: string;
}
