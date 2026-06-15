# Phase 2 (Host Engine) — Orchestration Completion (critic fix wave)

Closes the 3 defects from `evidence/phase-2/review.md` (FAIL → fix). Builder evidence;
re-verify with the Critic. Date: 2026-06-15. All paths cross-platform; verified cold on
Windows (the authoritative `windows-latest` class), Node 24.14.1 + Bun 1.3.14.

---

## Defect 1 — Real adapter dispatch + strict mock-gating (P03, RUBRIC §6.1)

**What changed.**
- `Orchestrator.startAgent` / `startAgentInWorkspace` / `launch` and the tRPC `agents.start`
  now take an explicit **adapter selection**: `adapterId ∈ {claude-code, codex-cli,
  cursor-agent, gemini-cli, generic, mock}`, plus an optional `command` (+`args`) for the
  `generic` adapter (or to override a named CLI's install path).
- `Orchestrator.resolveLaunchPlan` validates the request BEFORE any DB write and dispatches:
  - **real** selections → `getPreset(id)` → `launchTerminalAdapter({command,args,detection,env})`
    over the `PtySupervisor` (real PTY, ADR-0007a). `generic` requires an explicit command.
  - **`mock`** → `launchMockAgent`, but only after the gate passes.
- The session row's `adapterId` is now the **dispatched** adapter (was hardcoded `"mock"`).

**Mock gating (proof it is off the default path).**
- `launch` no longer passes `enable: options.enableMock ?? true`. The mock is reachable only
  when `adapterId==="mock"` **and** `isMockAdapterEnabled(enableMock)` is true — i.e. an
  explicit per-call `enableMock:true` **or** the process-wide `SWARM_ENABLE_MOCK_ADAPTER` env
  flag. An absent/real selection never touches the mock.
- The tRPC input intentionally exposes **no** `enableMock` field, so the only way the mock runs
  via the API is if the host operator set the env flag (test/dev) — never on a user happy path.
- `host-worker.ts` (the integration proof) **does not set** `SWARM_ENABLE_MOCK_ADAPTER`. The 3
  parallel mock agents pass `enableMock:true` explicitly (legitimate test use); the tRPC agent
  runs a real adapter. Unit gating is also covered by `mock-adapter.test.ts` (disabled by
  default; launching while disabled throws instead of faking).

**Real-path end-to-end proof.**
- `host-integration.test.ts` 4th agent (the tRPC command path) now dispatches
  `adapterId:"generic", command:"node", args:[fake-cli.mjs, …]` — a REAL terminal adapter, no
  mock, no mock gate. Assertions: `report.delta.adapterId === "generic"` (and `!== "mock"`),
  `status === "done"`, 4 workspace events persisted, output file landed only in its worktree.
- New `host-lifecycle.test.ts` independently dispatches a REAL `generic` adapter through the
  orchestrator (worktree → PTY → events → PGlite → `done`) and asserts the session's stored
  `adapterId === "generic"`, the CLI wrote its file, and ≥4 events persisted to PGlite.
- Result: `@swarm/host` 12/12 pass (8 integration + 4 lifecycle). P01/P02/P04 parallel mock
  proof preserved (ratio ≈2.56, all `running` before any `done`, isolation + live status + auth).

---

## Defect 2 — SwarmConfig setup/teardown actually executed (P07)

**What changed.**
- `@swarm/config` added as an `apps/host` dependency (via `bun add` in the package).
- `apps/host/src/lifecycle.ts`: `loadWorkspaceConfig(repoRoot)` reads + validates
  `<repo>/.grove/config.json` via `parseConfig` (null when absent). `runLifecyclePhase`
  resolves each `Command` per OS family (bare string → default shell; `{windows,posix}` →
  per-OS line + shell), injects `SWARM_ROOT_PATH`/`SWARM_WORKSPACE_NAME`/`SWARM_WORKSPACE_PATH`,
  runs the raw line on the PTY/shell layer with an exit-sentinel, and emits bounded
  `workspace.lifecycle` events (new `DomainEvent` variant; output stays out of the durable log
  per architecture §4).
- `Orchestrator.launch` runs `setup` to completion **before** launching the agent;
  `runTeardown` runs `teardown` after `session.exited`, and `run.done` resolves only once
  teardown completes.

**Test result (`host-lifecycle.test.ts`, captured worker report).** Project `.grove/config.json`:
`setup` writes `SETUP_RAN.txt` (content = injected `SWARM_WORKSPACE_NAME`); `teardown`
(per-OS object form) writes `TEARDOWN_RAN.txt`.

```
adapterId=generic  finalStatus=done  exitCode=0  outFileExists=true
setupMarkerExists=true  setupMarkerContent="agent-cfg"  teardownMarkerExists=true
setupSeqs=[2,3]  startedSeq=4  exitedSeq=7  teardownSeqs=[8,9]
setupBeforeAgent=true  teardownAfterAgent=true  persistedLifecycle=4
```

Ordering is exact: setup events (seq 2,3) precede `session.started` (4); teardown events
(8,9) follow `session.exited` (7). Marker content proves env-var injection. Lifecycle events
persisted to PGlite. When a repo has no `.grove/config.json` (the host-integration fixture),
config is `null` and no lifecycle runs — event counts unchanged (still 20).

---

## Defect 3 — Windows-CI robustness in `@swarm/agent-adapters`

**(a) fake-CLI → self-contained `.mjs`.** `packages/agent-adapters/src/fake-cli.ts` is replaced
by `fake-cli.mjs` (plain JS, no TS, no relative `.ts` import — protocol constants inlined).
`fakeCliPath()` now resolves `fake-cli.mjs` and the mock adapter invokes `node fake-cli.mjs`,
removing reliance on Node's strip-types `.ts` execution inside a PTY (unreliable on the GH
`windows-latest` runner, ADR-0011). `fake-cli.protocol.test.ts` pins the inlined constants in
lock-step with `mock-protocol.ts`. `mock-adapter.test.ts` updated to assert the `.mjs` path.

**(b) `detectAdapter` robustness.** Detection now invokes **`where.exe`** explicitly on Windows
(`which` on POSIX), parses multi-line output, trims, prefers the first absolute-path line
(ignoring stray `INFO:` lines), and treats a non-zero exit as `not_found`. The "resolves to
available" test now probes **`git`** — guaranteed present on every CI runner (actions/checkout
needs it) and locally — instead of an assumed toolchain CLI. `@swarm/agent-adapters` 39/39 pass.

---

## Cold / cache-disabled gate (ADR-0011 discipline) — run twice, non-flaky

Command set: `bun run lint` (root Biome) + `bunx turbo run typecheck build test --force`, plus
the §6.1 banned-token ripgrep over `apps packages docs`.

| Check | Run 1 | Run 2 |
|---|---|---|
| `bun run lint` (Biome) | OK | OK |
| `turbo run typecheck build test --force` | **42/42 tasks, 0 cached, exit 0** | **42/42 tasks, 0 cached, exit 0** |

Run-2 per-package test totals (all 0 fail): ui 60 · shared 4 · config 9 · agent-adapters 39 ·
sync 10 · pty-supervisor 4 · git-worktree 9 · host 12.

Banned-token scan: `rg -ni "TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem
ipsum|throw new Error\(['\"]unimplemented" apps packages docs` → **empty** (exit 1).

**Windows-under-load note (ADR-0011).** Adding a second PTY-spawning host suite lengthened the
overlap window of the cold `turbo --force` run, surfacing pre-existing too-tight internal
deadlines in the PTY workers (mock-worker 15s, pty-worker 12s) that buckled under concurrent
ConPTY contention on a constrained Windows box. Deadlines were widened (mock-worker 45s,
pty-worker 20s) and the worker spawn timeouts raised to match — assertions unchanged, only
patience. Each suite still passes standalone; the two consecutive cold runs above are green.

## Files
- Engine: `apps/host/src/{orchestrator,trpc,lifecycle,host-worker,host-lifecycle-worker}.ts`
- Adapters: `packages/agent-adapters/src/{terminal-adapter,presets,mock-adapter,fake-cli.mjs}.ts`
- Events: `packages/core-engine/src/index.ts` (`workspace.lifecycle`)
- Tests: `apps/host/src/{host-integration,host-lifecycle}.test.ts`,
  `packages/agent-adapters/src/{presets,mock-adapter,fake-cli.protocol}.test.ts`
