import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ChangeType } from "@swarm/db";
import type { Result, WorkspaceId } from "@swarm/shared";
import { err, ok, toPosixPath } from "@swarm/shared";

/**
 * @swarm/git-worktree — worktree/branch refs and the diff/status shapes the
 * engine and diff viewer share (spec §2, P02/P06), plus the real git invocation
 * behind P02 worktree isolation: each task gets its own branch + working
 * directory sharing one `.git` object store. All OS-touching git calls shell out
 * to the `git` CLI via `execFile` (no shell, so paths with spaces and drive
 * letters survive verbatim) and surface typed `Result`s instead of throwing.
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

// --- typed errors -----------------------------------------------------------

/** Every failure mode the engine reports, so callers branch on a code, not text. */
export const GIT_ERROR_CODES = [
  "git_not_found",
  "not_a_repo",
  "invalid_base",
  "branch_exists",
  "path_occupied",
  "dirty_worktree",
  "not_a_worktree",
  "invalid_path",
  "git_failed",
] as const;
export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

export interface GitError {
  readonly code: GitErrorCode;
  readonly message: string;
  /** Raw git stderr when the failure originated from a git invocation. */
  readonly stderr?: string;
}

// --- engine inputs / outputs ------------------------------------------------

export interface CreateWorktreeOptions {
  readonly workspaceId: WorkspaceId;
  /** New branch to cut for this task; must not already exist. */
  readonly branch: string;
  /** Base ref the new branch is cut from (branch, tag, or sha). */
  readonly baseBranch: string;
  /** OS path of the managed worktree directory (may contain spaces/drive letters). */
  readonly path: string;
}

export interface ImportWorktreeOptions {
  readonly workspaceId: WorkspaceId;
  /** Path of an existing on-disk worktree to (re)link to this repo. */
  readonly path: string;
  /** Base ref to record; defaults to the imported worktree's own branch. */
  readonly baseBranch?: string;
}

export interface RemoveOptions {
  /** Remove even when the working tree is dirty or the entry is locked. */
  readonly force?: boolean;
}

export interface PruneOptions {
  /** Expire missing worktrees older than this git time (e.g. "now"). */
  readonly expire?: string;
}

export interface StatusOptions {
  /** Ref to compute ahead/behind against; defaults to the upstream tracking ref. */
  readonly compareRef?: string;
}

/** One row of `git worktree list --porcelain`, normalized for cross-platform use. */
export interface WorktreeInfo {
  /** POSIX-normalized absolute worktree path. */
  readonly path: string;
  readonly head: string | null;
  /** Short branch name, or null when the worktree is detached or bare. */
  readonly branch: string | null;
  readonly isBare: boolean;
  readonly isDetached: boolean;
  readonly isLocked: boolean;
  readonly isPrunable: boolean;
}

/** Per-worktree status: which branch, how far from its base, and whether it is dirty. */
export interface WorktreeStatus {
  /** POSIX-normalized absolute worktree path. */
  readonly path: string;
  /** Short branch name, or null when detached. */
  readonly branch: string | null;
  readonly head: string;
  /** Commits on HEAD not on the compare ref. */
  readonly ahead: number;
  /** Commits on the compare ref not on HEAD. */
  readonly behind: number;
  /** True when there are staged, unstaged, or untracked changes. */
  readonly dirty: boolean;
  /** Number of entries reported by `git status --porcelain`. */
  readonly changedFiles: number;
}

// --- git invocation ---------------------------------------------------------

const execFileAsync = promisify(execFile);

/** Generous ceiling so a large `git status`/list never truncates (default is 1 MB). */
const MAX_BUFFER = 64 * 1024 * 1024;

interface ExecFailure {
  readonly code?: string | number;
  readonly stderr?: string;
  readonly message?: string;
}

function asExecFailure(error: unknown): ExecFailure {
  if (typeof error === "object" && error !== null) {
    const shape = error as { code?: unknown; stderr?: unknown; message?: unknown };
    return {
      code:
        typeof shape.code === "string" || typeof shape.code === "number" ? shape.code : undefined,
      stderr: typeof shape.stderr === "string" ? shape.stderr : undefined,
      message: typeof shape.message === "string" ? shape.message : undefined,
    };
  }
  return {};
}

/** Run `git <args>` (optionally inside `cwd`) and return stdout or a typed error. */
async function runGit(args: readonly string[], cwd?: string): Promise<Result<string, GitError>> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
    return ok(stdout);
  } catch (error) {
    const failure = asExecFailure(error);
    if (failure.code === "ENOENT") {
      return err({ code: "git_not_found", message: "git executable not found on PATH" });
    }
    const stderr = (failure.stderr ?? "").trim();
    return err({
      code: "git_failed",
      message: stderr || failure.message || "git command failed",
      stderr,
    });
  }
}

// --- path helpers -----------------------------------------------------------

/**
 * Resolve `p` to its canonical, POSIX-normalized real path. When the path exists
 * we follow it through the OS realpath so the two ways the same location can be
 * spelled collapse to one form — macOS canonicalizes temp dirs through a symlink
 * (`/var` → `/private/var`) and Windows may hand back 8.3 short names or a
 * different drive-letter case. When the path does not exist (yet) we fall back to
 * a plain `resolve`. This is what lets an adopted external worktree's ref compare
 * equal to what `git worktree list` reports, regardless of host.
 */
function canonicalPath(p: string): string {
  const resolved = resolve(p);
  try {
    return toPosixPath(realpathSync.native(resolved));
  } catch {
    return toPosixPath(resolved);
  }
}

/** Compare two filesystem paths by canonical real form, case-insensitively on Windows. */
function samePath(a: string, b: string): boolean {
  const na = canonicalPath(a);
  const nb = canonicalPath(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** True if `p` exists as a non-empty directory or as a file (i.e. cannot host a fresh worktree). */
async function pathIsOccupied(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    if (!info.isDirectory()) {
      return true;
    }
    const entries = await readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/** Conventional managed path for a workspace's worktree under a base directory. */
export function managedWorktreePath(worktreesDir: string, workspaceId: WorkspaceId): string {
  return join(resolve(worktreesDir), workspaceId);
}

// --- porcelain parsing ------------------------------------------------------

interface MutableWorktreeInfo {
  path: string;
  head: string | null;
  branch: string | null;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
}

function stripBranchRef(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function parseWorktreeList(out: string): WorktreeInfo[] {
  const records: WorktreeInfo[] = [];
  let current: MutableWorktreeInfo | null = null;
  const flush = (): void => {
    if (current) {
      records.push({ ...current, path: toPosixPath(current.path) });
      current = null;
    }
  };
  for (const line of out.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = {
        path: line.slice("worktree ".length),
        head: null,
        branch: null,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = stripBranchRef(line.slice("branch ".length));
    } else if (line === "bare") {
      current.isBare = true;
    } else if (line === "detached") {
      current.isDetached = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.isLocked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.isPrunable = true;
    }
  }
  flush();
  return records;
}

// --- engine -----------------------------------------------------------------

/**
 * Bound to one repository, manages the branch-per-task worktrees that give each
 * agent an isolated checkout over a shared object store (P02). Construct once
 * per project root; every method returns a typed `Result`.
 */
export class WorktreeEngine {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
  }

  /** Verify the bound root is inside a git repository. */
  private async ensureRepo(): Promise<Result<true, GitError>> {
    const probe = await runGit(["-C", this.repoRoot, "rev-parse", "--git-dir"]);
    if (!probe.ok) {
      if (probe.error.code === "git_not_found") {
        return probe;
      }
      return err({
        code: "not_a_repo",
        message: `not a git repository: ${this.repoRoot}`,
        stderr: probe.error.stderr,
      });
    }
    return ok(true);
  }

  /**
   * Enable Windows long paths so deep worktree + node_modules trees clear the
   * 260-char limit (spec §5). Best-effort and a no-op off Windows.
   */
  private async ensureLongPaths(): Promise<void> {
    if (process.platform === "win32") {
      await runGit(["-C", this.repoRoot, "config", "core.longpaths", "true"]);
    }
  }

  private async currentBranch(cwd: string): Promise<string | null> {
    const res = await runGit(["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
    if (!res.ok) {
      return null;
    }
    const name = res.value.trim();
    return name === "HEAD" ? null : name;
  }

  private async resolveUpstream(cwd: string): Promise<string | null> {
    const res = await runGit([
      "-C",
      cwd,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    return res.ok ? res.value.trim() : null;
  }

  /** Cut `branch` from `baseBranch` and check it out into a fresh worktree at `path`. */
  async create(options: CreateWorktreeOptions): Promise<Result<WorktreeRef, GitError>> {
    const repo = await this.ensureRepo();
    if (!repo.ok) {
      return repo;
    }
    const target = resolve(options.path);

    if (await pathIsOccupied(target)) {
      return err({
        code: "path_occupied",
        message: `target path already exists and is not empty: ${target}`,
      });
    }

    const base = await runGit([
      "-C",
      this.repoRoot,
      "rev-parse",
      "--verify",
      `${options.baseBranch}^{commit}`,
    ]);
    if (!base.ok) {
      return err({
        code: "invalid_base",
        message: `base ref does not resolve: ${options.baseBranch}`,
        stderr: base.error.stderr,
      });
    }

    const existing = await runGit([
      "-C",
      this.repoRoot,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${options.branch}`,
    ]);
    if (existing.ok) {
      return err({ code: "branch_exists", message: `branch already exists: ${options.branch}` });
    }

    await this.ensureLongPaths();
    await mkdir(dirname(target), { recursive: true });

    const add = await runGit([
      "-C",
      this.repoRoot,
      "worktree",
      "add",
      "-b",
      options.branch,
      target,
      options.baseBranch,
    ]);
    if (!add.ok) {
      return add;
    }

    return ok({
      workspaceId: options.workspaceId,
      branch: options.branch,
      baseBranch: options.baseBranch,
      path: toPosixPath(target),
    });
  }

  /** List every worktree registered against this repo (including the main one). */
  async list(): Promise<Result<WorktreeInfo[], GitError>> {
    const repo = await this.ensureRepo();
    if (!repo.ok) {
      return repo;
    }
    const res = await runGit(["-C", this.repoRoot, "worktree", "list", "--porcelain"]);
    if (!res.ok) {
      return res;
    }
    return ok(parseWorktreeList(res.value));
  }

  /**
   * Status of the worktree at `worktreePath`: branch, dirty flag, and ahead/behind
   * versus a compare ref (defaults to the upstream tracking branch).
   */
  async status(
    worktreePath: string,
    options?: StatusOptions,
  ): Promise<Result<WorktreeStatus, GitError>> {
    const target = resolve(worktreePath);

    const head = await runGit(["-C", target, "rev-parse", "HEAD"]);
    if (!head.ok) {
      return err({
        code: "not_a_worktree",
        message: `not a git worktree: ${target}`,
        stderr: head.error.stderr,
      });
    }

    const branch = await this.currentBranch(target);

    const porcelain = await runGit(["-C", target, "status", "--porcelain"]);
    if (!porcelain.ok) {
      return porcelain;
    }
    const changed = porcelain.value.split(/\r?\n/).filter((line) => line.length > 0);

    let ahead = 0;
    let behind = 0;
    const compareRef = options?.compareRef ?? (await this.resolveUpstream(target));
    if (compareRef) {
      const counts = await runGit([
        "-C",
        target,
        "rev-list",
        "--left-right",
        "--count",
        `${compareRef}...HEAD`,
      ]);
      if (counts.ok) {
        const [left, right] = counts.value.trim().split(/\s+/);
        const behindCount = Number(left ?? "0");
        const aheadCount = Number(right ?? "0");
        behind = Number.isFinite(behindCount) ? behindCount : 0;
        ahead = Number.isFinite(aheadCount) ? aheadCount : 0;
      }
    }

    return ok({
      path: toPosixPath(target),
      branch,
      head: head.value.trim(),
      ahead,
      behind,
      dirty: changed.length > 0,
      changedFiles: changed.length,
    });
  }

  /**
   * Remove the worktree at `worktreePath`. Refuses a dirty tree unless `force`,
   * so uncommitted agent work is never silently discarded.
   */
  async remove(worktreePath: string, options?: RemoveOptions): Promise<Result<true, GitError>> {
    const repo = await this.ensureRepo();
    if (!repo.ok) {
      return repo;
    }
    const target = resolve(worktreePath);
    const force = options?.force ?? false;

    if (!force) {
      const current = await this.status(target);
      if (!current.ok) {
        return current;
      }
      if (current.value.dirty) {
        return err({
          code: "dirty_worktree",
          message: `worktree has uncommitted changes; pass force to remove: ${target}`,
        });
      }
    }

    const args = ["-C", this.repoRoot, "worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(target);

    const res = await runGit(args);
    if (!res.ok) {
      if ((res.error.stderr ?? "").includes("is not a working tree")) {
        return err({
          code: "not_a_worktree",
          message: `not a registered worktree: ${target}`,
          stderr: res.error.stderr,
        });
      }
      return res;
    }
    return ok(true);
  }

  /** Prune administrative entries for worktrees whose directory is gone. */
  async prune(options?: PruneOptions): Promise<Result<string[], GitError>> {
    const repo = await this.ensureRepo();
    if (!repo.ok) {
      return repo;
    }
    const args = ["-C", this.repoRoot, "worktree", "prune", "--verbose"];
    if (options?.expire) {
      args.push("--expire", options.expire);
    }
    const res = await runGit(args);
    if (!res.ok) {
      return res;
    }
    const pruned = res.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return ok(pruned);
  }

  /**
   * Adopt an existing on-disk worktree: (re)link its administrative files to this
   * repo via `worktree repair`, then return its ref. Handles the
   * external-worktree-import path (recon §4).
   */
  async import(options: ImportWorktreeOptions): Promise<Result<WorktreeRef, GitError>> {
    const repo = await this.ensureRepo();
    if (!repo.ok) {
      return repo;
    }
    const target = resolve(options.path);

    try {
      const info = await stat(target);
      if (!info.isDirectory()) {
        return err({ code: "invalid_path", message: `import path is not a directory: ${target}` });
      }
    } catch {
      return err({ code: "invalid_path", message: `import path does not exist: ${target}` });
    }

    const head = await runGit(["-C", target, "rev-parse", "HEAD"]);
    if (!head.ok) {
      return err({
        code: "not_a_worktree",
        message: `path is not a git worktree: ${target}`,
        stderr: head.error.stderr,
      });
    }

    const repair = await runGit(["-C", this.repoRoot, "worktree", "repair", target]);
    if (!repair.ok) {
      return repair;
    }

    const listed = await this.list();
    if (!listed.ok) {
      return listed;
    }
    const match = listed.value.find((entry) => samePath(entry.path, target));
    const branch = match?.branch ?? (await this.currentBranch(target));
    if (!branch) {
      return err({
        code: "not_a_worktree",
        message: `worktree is detached; cannot import without a branch: ${target}`,
      });
    }

    return ok({
      workspaceId: options.workspaceId,
      branch,
      baseBranch: options.baseBranch ?? branch,
      // Canonical real path (the worktree exists on disk here), so the returned
      // ref matches `list()` output even when the temp root is symlinked (macOS)
      // or reported as a short/different-cased path (Windows).
      path: canonicalPath(target),
    });
  }
}
