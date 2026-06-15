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

---

# Phase 2 — `@swarm/git-worktree` flake under full parallel cold `turbo` (Windows file-lock contention)

**Date:** 2026-06-15 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14 · **Context:** `bun test packages/git-worktree` passed in isolation (9/9), but under a full cold `bunx turbo run typecheck build test --force` — all packages parallel, now including the heavy process-spawning suites (`@swarm/pty-supervisor`, `@swarm/agent-adapters`, and `apps/host`'s `host-integration.test`, which spawns a host + 4 mock agents) — `@swarm/git-worktree` intermittently failed (observed 2/4/6 failing tests across pre-fix runs). **Not a logic bug**: classic transient filesystem contention when many processes hammer the disk at once on Windows (antivirus / git `index.lock` / in-use handles).

**Two compounding manifestations, both addressed:**
1. **Transient hard failures** in fixture setup (`git init/config/add/commit`) and engine git ops — `Command failed: git add -A` / `git commit -m init|second`, EBUSY/EAGAIN/EPERM/EACCES, `index.lock`/`could not lock`/"being used by another process" / "permission denied".
2. **Per-test timeouts.** Once hard failures were retried away, the surviving symptom was the bun default **5000 ms** per-test timeout: under peak load a git-heavy test legitimately ran ~8.3 s (slow git spawns + bounded retry backoff), was killed mid-`create`, and the torn-down `expect(b.ok).toBe(true)` reported `false` ("Unhandled error between tests"). The slow path was *correct*, just over the default cliff.

**Fix (root-cause, product-quality — no masking, no coverage cut):**
- **Engine `src/index.ts`** — `runGit` now wraps `execFileAsync` in a **bounded retry** (max 5 attempts, exponential backoff 50→100→200→400 ms, capped 500 ms). Only *transient* failures retry: a spawn-errno allowlist (`EBUSY/EAGAIN/EACCES/EPERM/ETXTBSY/EMFILE/ENFILE/UNKNOWN`; `ENOENT`=git-not-found is excluded) or a stderr signature of FS contention (`index.lock`, `could not/cannot lock`, `unable to create/write/access/open/read`, `being used by another process`, `the process cannot access the file`, `permission denied`, `resource (temporarily) unavailable`, `operation not permitted`, `device or resource busy`, `bad file descriptor`, `input/output error`). Deterministic git errors (bad ref, branch exists, not-a-worktree) match none of these → surface immediately. After retries are exhausted the **original** failure is surfaced (same `git_failed` shape). Real agents on Windows hit these locks, so the engine itself is now resilient — not just the test.
- **Fixture `src/index.test.ts`** — the synchronous `git()` helper got the same bounded retry (same attempts/backoff, same transient classifier over errno+stderr+message; backoff uses `Atomics.wait` to block without busy-spin). Contract unchanged: still throws on a non-transient failure, re-throws the original error once exhausted. All 9 tests / 47 `expect()` calls unchanged — coverage preserved.
- **`package.json`** — test script `bun test` → `bun test --timeout 60000`: generous per-test headroom so the slow-but-correct under-load path never trips the 5 s default. (Same hardening pattern wave-2 used for `pty-supervisor`.)

**Turbo concurrency:** left at default (full parallelism). The retry + timeout headroom made the suite robust *regardless of concurrency* (the preferred outcome), so `turbo.json` was **not** modified — no concurrency cap, no suite marking needed.

**Verification (this Windows host):**
- `bun test packages/git-worktree` (isolation) → 9 pass, 0 fail, 47 expect().
- `bun run lint` (biome, root) → clean, 134 files. `bunx turbo run typecheck build test --force` (42 tasks, all packages parallel, cache-disabled) run **4× consecutively → 4/4 full-tree green** (42/42 tasks each; `@swarm/git-worktree` 9 pass / 0 fail every run). Pre-fix the same command failed on the majority of runs; post-fix the flake did not reproduce in 4 cold runs. (Note: `lint` is a root-level `biome check .`, not a turbo task, so it is run separately rather than via `turbo run lint`.)
- Banned-token scan (RUBRIC §6.1 pattern) over `apps packages docs` → clean; no new banned tokens.
- Only `packages/git-worktree/{src/index.ts,src/index.test.ts,package.json}` changed. The uncommitted Phase-2 work (apps/host daemon + host-integration test, packages/sync, packages/db, tsconfig.base.json, apps/cli) was left intact and built/typechecked/tested green as part of every cold run. Did not commit/push.

---

# Phase 2 — non-interactive PTY launch + `detectAdapter` PATH robustness (windows-latest, run 27527525976 @ ae3eed8)

**Date:** 2026-06-15 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14 · **Context:** two `@swarm/agent-adapters` tests were green locally + on ubuntu/macOS but red ONLY on `windows-latest` (3rd Windows iteration — no timeout bumps; root-cause fixes). Both fixes are robust-by-construction and keep every assertion intact or stronger. Confirmed against the CI log itself (not guessed).

## FAILURE (a) — "mock adapter integration … spawns → streams deterministic output → file change → running→done"

**Root cause (PSReadLine line-editor corruption).** The terminal adapter spawned an *interactive* shell PTY (`powershell.exe -NoLogo -NoProfile`) and then *typed* the launch command into it via `supervisor.write(line + "\r")`. The CI `Received` stream is the smoking gun: prompt `PS C:\Users\runneradmin\AppData\Local\Temp\grove mock-…>` ends near column 61, then PSReadLine emits cursor-reposition + syntax-color escapes (`[1;61H`, `[91m`/`[36m`/`[93m`) and re-renders the long, absolute-path command line TWICE (first render truncated at `$LASTEXIT`, then re-rendered to `$LASTEXITCODE`). On the GH runner the long line word-wraps past the console width and the re-render desyncs the input, so the command never executes cleanly: WORKER_DETAIL shows `token=false file=false … final=needs_attention` — the fake-CLI never ran, status stalled `running→needs_attention` and the test timed out (49 s).

**Fix (strategy switch — launch NON-INTERACTIVELY).** Keep a PTY allocated (TUI agents need it) but drive the shell via its own command argument instead of typing at a prompt. `PtySupervisor.spawn` gained an optional `command` body; `resolveShell(kind, command?)` returns a non-interactive invocation when it is set. `launchTerminalAdapter` now builds the same `buildLaunchLine` body (env + quoted command + exit-sentinel echo) and passes it as `spawn({ …, command })` — no `supervisor.write`. The exact invocations:

```
Windows powershell/pwsh : powershell.exe  -NoLogo -NoProfile -NonInteractive -Command "& '<cmd>' '<arg>' …; Write-Host \"__SWARM_EXIT__:$LASTEXITCODE\""
Windows cmd             : cmd.exe         /d /c "<cmd> <arg> … & echo __SWARM_EXIT__:%ERRORLEVEL%"
POSIX  bash/zsh/git-bash: <shell>         -c "<cmd> <arg> …; echo \"__SWARM_EXIT__:$?\""
```

node-pty's `argsToCommandLine` (CRT-compatible) quotes the body as a single argument and escapes embedded `"` as `\"`; PowerShell reconstructs and executes it verbatim. **Why this is robust on the GH runner:** the command is a *process argument*, never keyboard input, so no interactive prompt is opened and PSReadLine — the console line editor that re-rendered/word-wrapped the input — is never engaged (`-NonInteractive` further guarantees it). The dependency on console width / cursor math is eliminated by construction. The exit-sentinel parsing + status inference are unchanged: PowerShell `-Command` does not echo the command, node writes the deterministic tokens to the PTY, `Write-Host "__SWARM_EXIT__:$LASTEXITCODE"` prints the executed exit code, `scanOutput`'s digit-required regex matches `__SWARM_EXIT__:0` → `done`. Status flows `running → done` exactly as before.

**Same path used by REAL launches (P14).** The orchestrator's real-adapter dispatch (`apps/host/src/orchestrator.ts`) and the generic/named presets all route through this one `launchTerminalAdapter`, so real agent launches inherit the same non-interactive robustness — not just the mock. The host's P07 lifecycle runner (`runShellLine` in `apps/host/src/lifecycle.ts`) had the identical hazard (it typed long env-prefixed `setup`/`teardown` lines into an interactive shell — it passed on this run only by column-luck) and was converted to the same `spawn({ command })` mechanism. The supervisor's interactive spawn (no `command`) is unchanged, so its own probe (`pty-worker.ts`: spawn → resize → tree-kill of a sleeping grandchild) still exercises the interactive prompt path.

## FAILURE (b) — "detectAdapter … a present CLI resolves to available with a path"

**Root cause.** Detection resolved a bare command name via `where.exe`/`which`. The CI log shows the present-`git` probe returned `not_found` after 944 ms while the "missing CLI" probe passed — i.e. under the Bun test runtime on `windows-latest` the `where.exe` lookup failed for *every* input (a present binary was misreported), and the negative test passed only coincidentally. Locally `where.exe git` succeeds under both Node and Bun, so it cannot be reproduced here — the failure is environmental (the runner's bun→`where.exe`→PATH chain).

**Fix (robust by construction).** `resolveOnPath` now (1) short-circuits: if the command is already an absolute path that exists on disk, return it verbatim — no `where.exe`, no PATH dependence (also legitimate for a user-configured full CLI path); (2) for name lookups, never throws — it trims CR, splits multi-line output, takes the first absolute-looking line and prefers one that `existsSync`, accepts any extension (`.exe`/`.cmd`/`.bat`), and treats a non-zero exit with no usable path as not-found (`undefined`). The TEST now probes `process.execPath` — the absolute path of the runtime executing the test, guaranteed to exist on every runner — and asserts `status === "available"` + a non-empty `resolvedPath` that `existsSync` (not an exact string). This removes the `where.exe`/PATH variable entirely for the positive case (resolves in ~1.5 ms via the short-circuit, vs the 944 ms PATH scan) while the negative + generic tests still exercise the lookup/`not_found`/`unknown` paths.

## Files changed
- `packages/pty-supervisor/src/index.ts` — `PtySpawnOptions.command?`; `resolveShell(kind, command?)` non-interactive args; `spawn` passes it through.
- `packages/agent-adapters/src/terminal-adapter.ts` — non-interactive launch via `spawn({ command })`, drop interactive `write`; docs.
- `apps/host/src/lifecycle.ts` — `runShellLine` non-interactive via `spawn({ command })`, drop interactive `write`; docs.
- `packages/agent-adapters/src/presets.ts` — `resolveOnPath` absolute short-circuit + defensive `where.exe`/`which` parse.
- `packages/agent-adapters/src/presets.test.ts` — present-CLI probe uses `process.execPath` + asserts the path exists on disk.
- `packages/agent-adapters/src/status.ts` — `EXIT_SENTINEL` doc updated for non-interactive launch (digit-guard rationale retained).

## Verification (this Windows host; cannot reproduce the GH-runner failure locally — it passes locally)
- `bun run lint` (biome, 138 files) → clean.
- `bunx turbo run typecheck build test --force` (42 tasks, all packages, cache-disabled) run **2× consecutively → 2/2 full-tree green (42/42 each, 0 fail)**.
  - `@swarm/agent-adapters`: `mock adapter integration … running→done` → PASS (~6.8 s, was timing out at 49 s); `detectAdapter … available with a path` → PASS (~1.5 ms via the absolute short-circuit).
  - `@swarm/pty-supervisor` integration (powershell + cmd: spawn → resize → tree-kill of grandchild, the interactive-spawn path) → PASS — interactive spawn unbroken.
  - `apps/host` real `generic` dispatch + P07 setup/teardown (now non-interactive) → PASS.
- Banned-token scan (RUBRIC §6.1 pattern, incl. `unimplemented|stub`) over `apps packages docs` → clean (zero matches).
- Per-package deps only (new imports are Node builtins: `node:fs`, `node:path`, `node:process`). Did not commit/push.
