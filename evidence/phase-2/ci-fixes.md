# Phase 2 — wave-2 cross-platform CI fixes (windows-latest + macos-latest)

**Date:** 2026-06-15 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14 · **Context:** wave-2 (f282bff) was green on ubuntu + local Windows but red on `windows-latest` + `macos-latest` (CI run 27523361347) for two environment/timing-sensitive tests. Both fixes harden the product/test against the environment; **neither weakens coverage** (assertions are unchanged or stronger).

---

## Failure 1 — `@swarm/git-worktree` › "imports an existing external worktree"

**Symptom:** `expect(received).toBe(true)` → false on win + mac (passed on ubuntu + local Windows). The final assertion compared the path that `git worktree list` reports for the adopted worktree against the path the test passed in.

**Root cause — path identity, not product logic.** The two sides spelled the *same* on-disk location differently:
- **macOS** canonicalizes the temp root through a symlink: `os.tmpdir()` yields `/var/folders/...` but git (and `realpath`) report `/private/var/folders/...`.
- **Windows** can hand back an 8.3 short name or a different drive-letter case for the same directory.

The engine's `samePath` helper (and `import()`'s returned ref) only `resolve()`d + POSIX-normalized + case-folded — it never followed the path to its canonical real form, so the symlinked/shortened spellings never matched.

**Fix (at the engine layer, `packages/git-worktree/src/index.ts`):**
- Added `canonicalPath(p)`: `resolve()` then `fs.realpathSync.native()` where the path exists (collapsing `/var`→`/private/var` and Windows 8.3/case differences to one true form), falling back to a plain resolve when the path does not exist yet. POSIX-normalized output.
- `samePath` now compares `canonicalPath(a)` vs `canonicalPath(b)` (still case-folded on win32). This makes `import()`'s internal match against `git worktree list` robust, so the adopted branch is read from the list entry rather than a fallback.
- `import()` returns `canonicalPath(target)`, so the returned `WorktreeRef.path` matches what `list()` reports regardless of host.
- Test (`index.test.ts`): `samePathTest` now canonicalizes through `realpathSync.native` before comparing (independent re-implementation of the same contract; falls back to separator-normalize for already-removed/pruned paths). The space-in-path hazard and all 9 tests / 47 expect() calls are unchanged — coverage preserved.

## Failure 2 — `@swarm/pty-supervisor` › "spawns powershell, …, tree-kills the process tree"

**Symptom:** intermittently logged `childPid=null` → `WORKER_RESULT=FAIL` on Windows CI (it passed in wave-1, so a timing flake, not a regression).

**Root cause — single-shot read of an async-spawning tree.** The Node worker (`pty-worker.ts`) wrote the recipe, slept a fixed 3000 ms, then read the stream **once** to parse the grandchild's `CHILDPID`. On a loaded CI runner the powershell `Start-Process` grandchild had not yet launched + echoed its PID within 3 s, so the parse saw `null` and the assertion failed.

**Fix (`packages/pty-supervisor/src/pty-worker.ts`):**
- Added `waitUntil(predicate, deadline)` — bounded polling (200 ms interval, 12 s deadline).
- Phase 1: poll until the token has streamed AND (for PID-reporting recipes: powershell/pwsh/bash) the `CHILDPID=` line has appeared. cmd's `start /b` emits no PID, so for cmd we wait on the token only (no needless full-deadline stall).
- Phase 2: poll until the grandchild PID is actually visible to `tasklist`/`kill -0` before killing (the PID can be printed a beat before the OS process is listable).
- Phase 3: after `kill()`, poll until BOTH the root shell and the grandchild have truly exited, rather than asserting after a single fixed grace.
- **Assertion kept strong (and stronger for powershell):** `pass = tokenSeen && rootGone && childProven`, where for PID-reporting shells `childProven` requires the child *provably existed* (alive before kill) AND is gone after — a real tree-kill, not just a dead root. cmd (no PID by recipe) retains its original token + root-tree semantics, so this is not a coverage cut.
- Integration test (`index.test.ts`): `spawnSync` timeout 30 s → 90 s and the test timeout 35 s → 100 s, so the generous polling can never be cut off by a slow runner.

---

## Local verification (this Windows host, per-package only — not full-repo)

```
bun run --filter @swarm/git-worktree typecheck   → code 0
bun run --filter @swarm/git-worktree build        → Bundled 4 modules, index.js 31.45 KB, code 0
bun test packages/git-worktree                    → 9 pass, 0 fail, 47 expect() calls

bun run --filter @swarm/pty-supervisor typecheck  → code 0
bun run --filter @swarm/pty-supervisor build      → Bundled 1 module, index.js 2.86 KB, code 0
bun test packages/pty-supervisor                  → 4 pass, 0 fail (ran 5x consecutively: 5/5 green, ~3.7s each)
```

- powershell WORKER_DETAIL after the fix: `childPid=27616 token=true ansi=true childAliveBefore=true rootGone=true childGone=true → PASS` (strong child-existed-and-killed path genuinely exercised, not bypassed).
- Banned-token scan over both packages' `src/*.ts` (RUBRIC §6.1 pattern) → clean.
- Did not touch `packages/agent-adapters` (concurrently edited by another agent). Did not run full-repo build/test. Did not commit/push.
