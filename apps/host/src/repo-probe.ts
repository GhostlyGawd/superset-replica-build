import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RepoInfo {
  /** Absolute repo top-level path, as git reports it (forward slashes). */
  readonly root: string;
  /** Current branch name; falls back to `main` only for a detached HEAD. */
  readonly defaultBranch: string;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(stderr.trim() || (error as Error).message);
  }
}

/**
 * Validate that `path` is a REAL git working tree on this host (P08/open-project)
 * and resolve its top-level directory + current branch. Throws a descriptive
 * error — never fakes success — for a missing dir, a non-repo, or a bare repo.
 */
export async function probeGitRepo(path: string): Promise<RepoInfo> {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("a repository path is required");
  }
  if (!existsSync(trimmed) || !statSync(trimmed).isDirectory()) {
    throw new Error(`not a directory on this host: ${trimmed}`);
  }
  let inside: string;
  try {
    inside = (await git(trimmed, ["rev-parse", "--is-inside-work-tree"])).trim();
  } catch {
    throw new Error(`not a git repository: ${trimmed}`);
  }
  if (inside !== "true") {
    throw new Error(`not a git working tree (bare repo?): ${trimmed}`);
  }
  const root = (await git(trimmed, ["rev-parse", "--show-toplevel"])).trim();
  const branch = (await git(trimmed, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { root, defaultBranch: branch === "HEAD" ? "main" : branch };
}
