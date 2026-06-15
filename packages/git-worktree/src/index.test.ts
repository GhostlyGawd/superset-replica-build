import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@swarm/shared";
import { WorktreeEngine } from "./index";

// A space in the prefix forces every path under test to contain a space, which
// is exactly the Windows hazard (`C:\Users\John Doe\...`) the engine must survive.
const TMP_PREFIX = join(tmpdir(), "grove wt-");

/** Run git synchronously during fixture setup; throws on failure (setup must be sound). */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
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
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
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
