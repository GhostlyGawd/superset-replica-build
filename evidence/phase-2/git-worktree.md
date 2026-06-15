# Phase 2 — git worktree engine (`packages/git-worktree`, PARITY P02)

**Date:** 2026-06-14 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14, git 2.53.0.windows.2 · **Result:** GATE PASSED — typecheck + build + tests green on the Windows host.

The worktree engine is the isolation primitive: each agent task gets its own branch and working directory implemented as a **git worktree** (not a clone), so all worktrees share one `.git` object store — cheap on disk while fully isolating checkout, index, and untracked files.

---

## 1. What was implemented

`WorktreeEngine` (constructed with a repo root) wraps real `git` CLI calls via `node:child_process` `execFile` (promisified). **Zero new dependencies** — native git, no `simple-git`. All package contracts that already existed (`WorktreeRef`, `FileChange`, `DiffHunk`, `FileDiff`, `GIT_WORKTREE_VERSION`) are preserved; the engine and its types were added alongside them.

Operations (all return typed `Result<T, GitError>`, never throw on the happy path):

- **`create`** — `rev-parse` validates the base ref resolves and the new branch does *not* already exist, then `git worktree add -b <branch> <path> <baseBranch>` cuts a new branch per task into a managed dir. Pre-checks return typed `invalid_base` / `branch_exists` / `path_occupied` instead of leaking git stderr.
- **`list`** — parses `git worktree list --porcelain` into `WorktreeInfo[]` (path, head, branch, bare/detached/locked/prunable flags).
- **`status`** — branch, dirty flag (`status --porcelain`), and ahead/behind via `rev-list --left-right --count <ref>...HEAD` (defaults to the upstream tracking ref; accepts an explicit `compareRef`).
- **`remove`** — refuses a dirty tree unless `{ force: true }` (proactive `status` check → typed `dirty_worktree`), so uncommitted agent work is never silently discarded; maps the "not a working tree" case to `not_a_worktree`.
- **`prune`** — `git worktree prune --verbose [--expire <t>]`, returns the pruned lines.
- **`import`** — adopts an existing/external on-disk worktree: validates the dir, confirms it is a worktree, runs `git worktree repair` to (re)link it to this repo, then reads its branch and returns a `WorktreeRef` (the recon §4 external-worktree-import path).

`GitError` carries a closed `GitErrorCode` union (`git_not_found`, `not_a_repo`, `invalid_base`, `branch_exists`, `path_occupied`, `dirty_worktree`, `not_a_worktree`, `invalid_path`, `git_failed`). A `managedWorktreePath(dir, workspaceId)` helper builds conventional managed paths.

## 2. Isolation proof (the core P02 assertion)

Integration test creates two worktrees (`task/a`, `task/b`) off `main` in one fixture repo, then:

- Writes a new untracked file in worktree A → it exists in A and is **absent** in B.
- Edits a tracked file (`README.md`) in A → B's copy is **byte-identical to the committed blob** (separate working trees + indexes).
- `status(A).dirty === true` while `status(B).dirty === false`, each on its own branch.

Both worktrees still see the shared committed history (`README.md` present in both), proving the shared object store. After committing in A, `status(A, { compareRef: "main" })` reports `ahead: 1, behind: 0, dirty: false`.

## 3. Cross-platform / Windows handling — how it is verified

- **No shell, ever.** `execFile("git", argsArray)` passes arguments without a shell, so **paths with spaces survive verbatim**. The test temp root is created with `mkdtemp(join(tmpdir(), "grove wt-"))` — the space in the prefix forces *every* path under test (repo, worktrees, the imported `external space dir`) to contain a space, exercising the `C:\Users\John Doe\...` hazard end-to-end. All 9 tests pass.
- **No hardcoded separators.** All path math uses `node:path` (`resolve`/`join`/`dirname`). Stored `WorktreeRef.path` / `WorktreeInfo.path` are POSIX-normalized via `toPosixPath` (spec §5) — asserted: created refs contain no `\`.
- **Drive letters & case.** Path comparisons (import/list matching) go through a `samePath` helper that resolves both sides and compares case-insensitively on `win32` only.
- **260-char limit.** `create` runs `git config core.longpaths true` (Windows only, best-effort) before `worktree add`, so deep worktree + node_modules trees clear the limit.
- **EOL determinism.** Fixture pins `core.autocrlf=false` so working-tree bytes equal the committed blob regardless of the host's global git config.

## 4. Windows-specific issue hit + fix

First test run failed on the isolation assertion: the host's **global `core.autocrlf=true`** rewrote the checked-out `README.md` to CRLF, so `"hello\n"` read back as `"hello\r\n"`. The isolation logic was correct; the fixture was inheriting host git config. **Fix:** the fixture repo now sets `core.autocrlf=false` (hermetic fixture), making the test independent of host/CI git settings. Re-ran → green.

## 5. Gate results (this package only, Windows host)

```
bun run --filter @swarm/git-worktree typecheck   → Exited with code 0
bun run --filter @swarm/git-worktree build        → Bundled 4 modules, index.js 31.25 KB, code 0
bun test packages/git-worktree                    → 9 pass, 0 fail, 47 expect() calls (10.7s)
```

- Banned-token scan over `packages/git-worktree/src` (`TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem ipsum|unimplemented|stub`) → no matches.
- Temp-dir cleanup verified: `afterEach` removes each fixture tree (force + retries, swallowed on failure so cleanup never masks a result); post-run scan of `tmpdir()` shows 0 leftover `grove wt-` dirs.
- No new dependencies added; root `package.json` untouched. Added only a `"test": "bun test"` script to this package (matching siblings). Did not run a full-repo install or build; did not commit/push.
