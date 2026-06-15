# Phase 2 — agent adapters (`packages/agent-adapters`, PARITY P03; feeds P01/P04)

**Date:** 2026-06-15 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14 · **Result:** GATE PASSED — typecheck + build + tests green, Biome clean, no banned tokens (this package, Windows host).

These adapters let Grove run real CLI coding agents inside a PTY, stream their output, and infer status. They build on the existing typed descriptors in `src/index.ts` (not redefining them) and on `@swarm/pty-supervisor` (P05/P14). Status is emitted as the **shared agent-state enum** (`WorkspaceStatus` from `@swarm/db`), so a value drops straight into the design system's `STATUS_META` (color/label/shape) — this is the signal P04 monitoring/notifications consumes.

---

## 1. What was implemented

- **Universal terminal adapter** (`terminal-adapter.ts`, zero-config) — `launchTerminalAdapter({ supervisor, command, args, cwd, shell, env, detection, onData, onStatus })`. It spawns a shell PTY through `@swarm/pty-supervisor`, writes a per-shell launch line (the same shell-driving shape as `pty-worker`), streams output, and infers status. It depends on the supervisor only **by type** (`Pick<PtySupervisor, …>`), so no node-pty is imported here and the bundle stays native-free; the supervisor instance is injected by the caller (which must run under Node, ADR-0007a).
- **Named presets** (`presets.ts`) for **Claude Code, OpenAI Codex CLI, Cursor Agent, Gemini CLI, + generic** — each is the existing built-in descriptor plus tuned `StatusDetection` (idle ms, prompt/done/error patterns) and env. `detectAdapter(preset)` probes the CLI on PATH via `where`/`which` and **degrades gracefully**: `available` (+ resolved path), `not_found` (with an actionable "install it / set a custom command" message), or `unknown` (generic). It never throws and never fakes success.
- **Headless mock adapter** (`mock-adapter.ts`, behind an explicit flag) — `launchMockAgent(...)` is **disabled by default**; it runs only when `enable: true` or `SWARM_ENABLE_MOCK_ADAPTER=1`, and **throws** otherwise (never a faked happy path). It launches a bundled fake CLI (`fake-cli.ts`, a real Node script run in the PTY under Node) that prints deterministic output, simulates a short working phase, **writes `AGENT_OUTPUT.md` into its working dir** (so the diff viewer has real content), prints a done marker, and exits 0 → `done`.
- Descriptor definitions moved to `descriptors.ts` (verbatim shapes, no contract change); `index.ts` re-exports them + all new modules, so the public API of `@swarm/agent-adapters` is unchanged and additive.

## 2. How status is inferred (`status.ts`, pure + unit-tested)

`AgentStatus = Extract<WorkspaceStatus, "running" | "needs_attention" | "done" | "error">` — a compile-time subset of the shared enum (`idle` is a workspace-at-rest state owned by core-engine, never emitted by a live agent).

- **Exit is authoritative.** The supervisor spawns a *shell*, not the agent process, so there is no process-exit event. The launch line appends an exit-code echo (`__SWARM_EXIT__:$LASTEXITCODE` / `%ERRORLEVEL%` / `$?`). `scanOutput` matches the sentinel **only when it carries digits**, so the shell's input-echo of the unexpanded form is correctly ignored. Code 0 → `done`; non-zero → `error` (both terminal/sticky).
- **`needs_attention`** comes from a refreshable idle timer (no output for `idleMs` while `running`) or a prompt pattern (`(y/n)`, "press enter", `…?`).
- **`running`** is any other activity; **done patterns** mark a finished turn without ending the process. A small carry buffer (96 chars) bridges a sentinel split across two PTY reads without re-matching stale prompts. Generic detection keeps `errorPatterns` empty (exit-only) to avoid false errors from agents that merely print "error".

Pure functions `scanOutput` / `nextFromOutput` / `nextFromIdle` / `isTerminal` are unit-tested directly; the live adapter wires PTY data + a `setTimeout` idle timer around them.

## 3. Mock-adapter test result (real PTY, via the Node worker pattern)

`mock-adapter.test.ts` (bun test, orchestrator) spawns `node mock-worker.ts <tmpdir>` — reusing the existing `pty-worker` pattern, because node-pty can't run under Bun on Windows (ADR-0007a). The worker drives the mock adapter through a **real `PtySupervisor`** and surfaces the streamed bytes. Asserted, all passing:

```
WORKER_DETAIL shell=powershell statuses=running|done token=true file=true heading=true final=done outputFile=…/grove mock-…/AGENT_OUTPUT.md
WORKER_RESULT=PASS
```

- **spawn → stream:** the streamed PTY section contains the deterministic banner token `SWARM-MOCK-AGENT` and the `__SWARM_MOCK_DONE__` marker.
- **running → done:** observed status sequence is `running|done`, final `done`.
- **file change:** the orchestrator independently asserts `AGENT_OUTPUT.md` exists in the temp worktree and contains the expected heading.
- Verified under **both `powershell` and `cmd`** (manual worker runs); the temp dir uses a `grove mock-` prefix (space in path) to exercise the `C:\Users\John Doe` hazard.

Unit tests also cover the mock gating (disabled by default; throws while disabled; enabled by env/flag) and the named-preset descriptors + `detectAdapter` (available / not_found / unknown).

## 4. Windows / PTY-under-Node issue hit + fix

1. **`.ts` import extensions vs tsc.** `mock-worker.ts` / `fake-cli.ts` must use explicit `.ts` on relative imports (Node ESM + Node 24 type-stripping require the extension), but `tsc` (moduleResolution Bundler) rejected them (TS5097). **Fix:** added `"allowImportingTsExtensions": true` to this package's `tsconfig.json` — the exact convention `pty-supervisor` already uses for its Node-run worker.
2. **Workspace links.** Bun uses an isolated per-package `node_modules`; this package had none. Declared `@swarm/{pty-supervisor,shared,db}` as `workspace:*` deps and linked them via `bun add` (package-scoped, not a full-repo install).
3. **Streaming assertion.** First integration run: the worker verified the token internally but didn't echo the captured PTY stream, so the orchestrator couldn't assert on streamed bytes. **Fix:** the worker now prints the stream between `WORKER_STREAM_BEGIN/END` markers and the test asserts on the real bytes.

## 5. Gate results (this package only, Windows host)

```
bun run --filter @swarm/agent-adapters typecheck   → Exited with code 0
bun run --filter @swarm/agent-adapters build        → Bundled 7 modules, index.js 10.31 KB, code 0
bun test packages/agent-adapters                     → 35 pass, 0 fail, 80 expect() calls
biome check packages/agent-adapters/src              → clean (no diagnostics)
```

- Banned-token scan over `packages/agent-adapters/src` (`TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem ipsum|unimplemented|stub`) → no matches. The mock adapter is a real, working feature gated behind an explicit flag.
- **Zero external dependencies added** — only three internal `workspace:*` deps (`@swarm/pty-supervisor`, `@swarm/shared`, `@swarm/db`). Root `package.json` untouched (`bun.lock` regenerates at merge). No full-repo install/build; not committed/pushed.
