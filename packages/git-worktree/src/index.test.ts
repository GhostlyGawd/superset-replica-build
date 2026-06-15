import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@swarm/shared";
import { WorktreeEngine } from "./index";

// A space in the prefix forces every path under test to contain a space, which
// is exactly the Windows hazard (`C:\Users\John Doe\...`) the engine must survive.
const TMP_PREFIX = join(tmpdir(), "grove wt-");

// Bounded retry for fixture git calls. Under a full parallel `turbo run test`
// (PTY/process-spawning suites hammering the disk at once) these synchronous
// setup commands (`init`/`add`/`commit`/`config`) intermittently fail on Windows
// with file-lock / antivirus contention. Retrying a transient failure a few
// times with a short backoff makes fixture setup robust without masking a real
// error: deterministic failures match none of the transient signatures and throw
// at once, and the original error is re-thrown once attempts are exhausted.
const MAX_GIT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 500;

/** Signatures (errno or git stderr) of OS-level contention that clears on retry. */
const TRANSIENT_GIT =
  /EBUSY|EAGAIN|EACCES|EPERM|ETXTBSY|EMFILE|ENFILE|UNKNOWN|index\.lock|could not lock|cannot lock|unable to (?:create|write|access|open|read)|being used by another process|the process cannot access the file|permission denied|resource (?:temporarily )?unavailable|operation not permitted|device or resource busy|bad file descriptor|input\/output error/i;

function isTransientGitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const e = error as { code?: unknown; stderr?: unknown; message?: unknown };
  if (e.code === "ENOENT") {
    return false; // missing `git`, not transient
  }
  const stderr =
    typeof e.stderr === "string"
      ? e.stderr
      : Buffer.isBuffer(e.stderr)
        ? e.stderr.toString("utf8")
        : "";
  const text = [typeof e.code === "string" ? e.code : "", stderr, e.message ?? ""].join("\n");
  return TRANSIENT_GIT.test(text);
}

/** Block the calling thread for `ms` without busy-spinning (sync fixture path). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run git synchronously during fixture setup; throws on failure (setup must be sound). */
function git(cwd: string, ...args: string[]): string {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_GIT_ATTEMPTS; attempt += 1) {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8" });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_GIT_ATTEMPTS && isTransientGitError(error)) {
        sleepSync(Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

interface Fixture {
  readonly root: string;
  readonly repoPath: string;
  readonly engine: WorktreeEngine;
}

let fixture: Fixture;

/** A repo on branch `main` with two commits (`README.md`, then `second.txt`). */
async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(TMP_PREFIX);
  const repoPath = join(root, "repo");
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.email", "grove@example.com");
  git(repoPath, "config", "user.name", "Grove Test");
  git(repoPath, "config", "commit.gpgsign", "false");
  // Pin EOL handling so working-tree content is byte-identical to the committed
  // blob regardless of the host's global core.autocrlf (Windows hosts default it
  // on), keeping the isolation assertions hermetic.
  git(repoPath, "config", "core.autocrlf", "false");
  writeFileSync(join(repoPath, "README.md"), "hello\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-m", "init");
  writeFileSync(join(repoPath, "second.txt"), "two\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-m", "second");
  return { root, repoPath, engine: new WorktreeEngine(repoPath) };
}

function samePathTest(a: string, b: string): boolean {
  // Canonicalize through the OS realpath where the path exists, so a symlinked
  // temp root (macOS `/var` → `/private/var`) or a Windows short/cased path
  // collapses to one true form before comparing — the same contract the engine's
  // own `samePath` enforces. Falls back to a plain separator-normalize when the
  // path is gone (e.g. an already-removed/pruned worktree).
  const canon = (p: string): string => {
    try {
      return realpathSync.native(p).replace(/\\/g, "/");
    } catch {
      return p.replace(/\\/g, "/");
    }
  };
  const na = canon(a);
  const nb = canon(b);
  return process.platform === "win32" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

beforeEach(async () => {
  fixture = await makeFixture();
});

afterEach(async () => {
  // Best-effort: never let cleanup failures (Windows read-only pack files / locks)
  // mask the real test result, but always try to reclaim the temp tree.
  try {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // swallow — temp dir cleanup is not a test assertion
  }
});

describe("@swarm/git-worktree WorktreeEngine", () => {
  test("creates two isolated worktrees on their own branches", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    const bPath = join(root, "wts", "b");

    const a = await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });
    const b = await engine.create({
      workspaceId: asId("ws_b"),
      branch: "task/b",
      baseBranch: "main",
      path: bPath,
    });

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }

    // Stored path is POSIX-normalized even though it was created from an OS path.
    expect(a.value.path.includes("\\")).toBe(false);
    expect(a.value.branch).toBe("task/a");
    expect(a.value.baseBranch).toBe("main");

    // Both share the committed history (shared object store).
    expect(existsSync(join(aPath, "README.md"))).toBe(true);
    expect(existsSync(join(bPath, "README.md"))).toBe(true);
  });

  test("a file written in one worktree does not appear in the other", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    const bPath = join(root, "wts", "b");
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });
    await engine.create({
      workspaceId: asId("ws_b"),
      branch: "task/b",
      baseBranch: "main",
      path: bPath,
    });

    // New untracked file only in A.
    writeFileSync(join(aPath, "only-a.txt"), "private to a\n");
    expect(existsSync(join(aPath, "only-a.txt"))).toBe(true);
    expect(existsSync(join(bPath, "only-a.txt"))).toBe(false);

    // Editing a tracked file in A leaves B's checkout untouched.
    writeFileSync(join(aPath, "README.md"), "changed-in-a\n");
    expect(readFileSync(join(bPath, "README.md"), "utf8")).toBe("hello\n");

    const sa = await engine.status(aPath);
    const sb = await engine.status(bPath);
    expect(sa.ok && sa.value.dirty).toBe(true);
    expect(sb.ok && sb.value.dirty).toBe(false);
    expect(sa.ok && sa.value.branch).toBe("task/a");
    expect(sb.ok && sb.value.branch).toBe("task/b");
  });

  test("list reports the main repo plus every created worktree", async () => {
    const { engine, root } = fixture;
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: join(root, "wts", "a"),
    });
    await engine.create({
      workspaceId: asId("ws_b"),
      branch: "task/b",
      baseBranch: "main",
      path: join(root, "wts", "b"),
    });

    const listed = await engine.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    const branches = listed.value.map((entry) => entry.branch);
    expect(branches).toContain("main");
    expect(branches).toContain("task/a");
    expect(branches).toContain("task/b");
    expect(listed.value.length).toBe(3);
  });

  test("status computes ahead/behind against a compare ref", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });

    writeFileSync(join(aPath, "work.txt"), "task output\n");
    git(aPath, "add", "-A");
    git(aPath, "commit", "-m", "work in a");

    const status = await engine.status(aPath, { compareRef: "main" });
    expect(status.ok).toBe(true);
    if (!status.ok) {
      return;
    }
    expect(status.value.ahead).toBe(1);
    expect(status.value.behind).toBe(0);
    expect(status.value.dirty).toBe(false);
  });

  test("create rejects a duplicate branch, a bad base, and an occupied path", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });

    const dupBranch = await engine.create({
      workspaceId: asId("ws_dup"),
      branch: "task/a",
      baseBranch: "main",
      path: join(root, "wts", "dup"),
    });
    expect(dupBranch.ok).toBe(false);
    expect(!dupBranch.ok && dupBranch.error.code).toBe("branch_exists");

    const badBase = await engine.create({
      workspaceId: asId("ws_bad"),
      branch: "task/bad",
      baseBranch: "no-such-ref",
      path: join(root, "wts", "bad"),
    });
    expect(badBase.ok).toBe(false);
    expect(!badBase.ok && badBase.error.code).toBe("invalid_base");

    const occupied = await engine.create({
      workspaceId: asId("ws_occ"),
      branch: "task/occ",
      baseBranch: "main",
      path: aPath,
    });
    expect(occupied.ok).toBe(false);
    expect(!occupied.ok && occupied.error.code).toBe("path_occupied");
  });

  test("remove refuses a dirty worktree without force, then removes with force", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });
    writeFileSync(join(aPath, "dirty.txt"), "uncommitted\n");

    const refused = await engine.remove(aPath);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe("dirty_worktree");
    expect(existsSync(aPath)).toBe(true);

    const forced = await engine.remove(aPath, { force: true });
    expect(forced.ok).toBe(true);
    expect(existsSync(aPath)).toBe(false);

    const listed = await engine.list();
    expect(listed.ok && listed.value.some((entry) => samePathTest(entry.path, aPath))).toBe(false);
  });

  test("prune drops the entry for a worktree whose directory was deleted", async () => {
    const { engine, root } = fixture;
    const aPath = join(root, "wts", "a");
    await engine.create({
      workspaceId: asId("ws_a"),
      branch: "task/a",
      baseBranch: "main",
      path: aPath,
    });

    await rm(aPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    const pruned = await engine.prune({ expire: "now" });
    expect(pruned.ok).toBe(true);

    const listed = await engine.list();
    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.value.some((entry) => samePathTest(entry.path, aPath))).toBe(false);
  });

  test("imports an existing external worktree", async () => {
    const { engine, repoPath, root } = fixture;
    const extPath = join(root, "external space dir");
    // Stand up an out-of-band worktree, then adopt it through the engine.
    git(repoPath, "worktree", "add", "-b", "ext/imported", extPath, "main");

    const imported = await engine.import({
      workspaceId: asId("ws_ext"),
      path: extPath,
      baseBranch: "main",
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    expect(imported.value.branch).toBe("ext/imported");
    expect(imported.value.baseBranch).toBe("main");
    expect(imported.value.path.includes("\\")).toBe(false);

    const listed = await engine.list();
    expect(listed.ok && listed.value.some((entry) => samePathTest(entry.path, extPath))).toBe(true);
  });

  test("status and import report typed errors for non-worktree paths", async () => {
    const { engine, root } = fixture;
    const missing = join(root, "nowhere");

    const status = await engine.status(missing);
    expect(status.ok).toBe(false);
    expect(!status.ok && status.error.code).toBe("not_a_worktree");

    const imported = await engine.import({ workspaceId: asId("ws_x"), path: missing });
    expect(imported.ok).toBe(false);
    expect(!imported.ok && imported.error.code).toBe("invalid_path");
  });
});

describe("@swarm/git-worktree diff viewer (P06)", () => {
  test("changes() reports modified + untracked files with line counts", async () => {
    const { engine, repoPath } = fixture;
    // README.md (committed "hello\n") gets an uncommitted edit; add a new file.
    writeFileSync(join(repoPath, "README.md"), "hello\nworld\n");
    writeFileSync(join(repoPath, "fresh.txt"), "a\nb\nc\n");

    const result = await engine.changes(repoPath);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const byPath = new Map(result.value.map((c) => [c.path, c]));
    const readme = byPath.get("README.md");
    expect(readme?.changeType).toBe("modified");
    expect(readme?.additions).toBe(1); // +"world"
    const fresh = byPath.get("fresh.txt");
    expect(fresh?.changeType).toBe("added");
    expect(fresh?.additions).toBe(3);
  });

  test("fileDiff() returns real hunks plus old + new text", async () => {
    const { engine, repoPath } = fixture;
    writeFileSync(join(repoPath, "README.md"), "hello\nworld\n");

    const result = await engine.fileDiff(repoPath, "README.md");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.oldText).toBe("hello\n");
    expect(result.value.newText).toBe("hello\nworld\n");
    expect(result.value.hunks.length).toBeGreaterThan(0);
    const addedLines = result.value.hunks.flatMap((h) => h.lines).filter((l) => l.startsWith("+"));
    expect(addedLines.some((l) => l.includes("world"))).toBe(true);
  });

  test("fileDiff() synthesizes a whole-file add hunk for an untracked file", async () => {
    const { engine, repoPath } = fixture;
    writeFileSync(join(repoPath, "fresh.txt"), "one\ntwo\n");

    const result = await engine.fileDiff(repoPath, "fresh.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.oldText).toBe("");
    expect(result.value.hunks).toHaveLength(1);
    expect(result.value.hunks[0]?.lines).toEqual(["+one", "+two"]);
  });

  test("writeFile() saves real content back, and rejects path traversal", async () => {
    const { engine, repoPath } = fixture;

    const saved = await engine.writeFile(repoPath, "README.md", "rewritten\n");
    expect(saved.ok).toBe(true);
    expect(readFileSync(join(repoPath, "README.md"), "utf8")).toBe("rewritten\n");

    const escaped = await engine.writeFile(repoPath, "../escape.txt", "nope");
    expect(escaped.ok).toBe(false);
    expect(!escaped.ok && escaped.error.code).toBe("invalid_path");
    expect(existsSync(join(repoPath, "..", "escape.txt"))).toBe(false);
  });
});
