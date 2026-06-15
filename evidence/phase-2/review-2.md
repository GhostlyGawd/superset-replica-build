# Phase 2 (Host Engine) — Critic RE-Review (post-fix-wave)

Independent critic; did NOT build this. Graded from the request + artifacts only (no
builder chat/reasoning provided). Verified mechanically where possible.

**HEAD reviewed:** `f2bdfb6` (`fix(adapters): non-interactive PTY launch — fix Windows-only CI stall`).
**Date:** 2026-06-15.

## Overall verdict: FAIL

One §6.1 blocker survives the fix wave: the authoritative **`windows-latest` CI job is RED on
HEAD** (`f2bdfb6`), run **27529136706**. `macos-latest`=success, `ubuntu-latest`=success,
`windows-latest`=**failure**. The two code-level defects (#2 mock-gating/real-dispatch, #3
SwarmConfig execution) are genuinely fixed and proven green on macOS+ubuntu, but the engine
core agent-launch path STILL does not work on the GitHub Windows runner, which was the entire
point of defect #1's fix. §6.1: "a red Windows job = NOT done."

Counts: **PASS 8 / FAIL 1 / PENDING 0** (the one FAIL is dispositive).

---

## The 3 prior defects — re-verification

| Prior defect | Result | Proof inspected |
|---|---|---|
| **#1 Windows CI red** (agent-adapters) | **FAIL** | `gh run view 27529136706` (HEAD `f2bdfb6`): windows-latest = **failure**; mac/ubuntu = success. Failing step = `Test (bun test)`; failing task = `@swarm/agent-adapters#test`; failing test = `mock adapter integration (real PTY via Node worker) > spawns -> streams ... running->done` [49116ms]. Runner worker detail: `shell=powershell statuses=running|needs_attention token=false file=false heading=false final=needs_attention`. The streamed PTY bytes are only ConPTY init + window-title escapes — the launched `node fake-cli.mjs` produced NO output. The non-interactive launch (the f2bdfb6 fix) did not resolve it. |
| **#2 mock un-gated + no real dispatch** | **PASS (code; mac/ubuntu)** | `orchestrator.ts:247-277` `resolveLaunchPlan`: `adapterId` REQUIRED (throws if undefined); mock runs ONLY when `selection==="mock"` AND `isMockAdapterEnabled(options.enableMock)` (`mock-adapter.ts:28-34`, env `SWARM_ENABLE_MOCK_ADAPTER` or explicit flag) — no `?? true`. Real adapters dispatched via `launchTerminalAdapter` (`orchestrator.ts:351-363`). `trpc.ts:85-122` `agents.start` has a required `adapterId` enum and passes NO `enableMock` to `startAgentInWorkspace` -> mock unreachable over the API unless the host operator sets the env. Real `generic` proven: `host-integration.test.ts:233-244` asserts `delta.adapterId==="generic"` and `!=="mock"`; `host-lifecycle.test.ts:102-111` asserts `generic` -> `done`. |
| **#3 SwarmConfig validated but never executed** | **PASS (code; mac/ubuntu)** | `lifecycle.ts:44-62` loads `.grove/config.json`; `orchestrator.ts:305,321-332` runs `setup` BEFORE launch; `orchestrator.ts:457` runs `runTeardown` AFTER `session.exited`, and `done` resolves only after teardown. Events streamed as `workspace.lifecycle` (`lifecycle.ts:197-225`). `host-lifecycle.test.ts:113-128` proves `max(setupSeqs) < startedSeq` and `min(teardownSeqs) > exitedSeq`, plus env injection (`setupMarkerContent === workspaceName`, i.e. `SWARM_WORKSPACE_NAME`). |

### Non-interactive launch (the Windows fix) — verified present, ineffective on the runner

`pty-supervisor/src/index.ts:72-99` `resolveShell(kind, command)`: with a `command` body the shell is
spawned `powershell -NoLogo -NoProfile -NonInteractive -Command <body>` / `cmd /d /c <body>` /
`bash -c <body>`; `spawn()` (`index.ts:122-130`) passes it to `nativeSpawn(file, args)`.
`terminal-adapter.ts:148-212` composes the launch line and does NOT `write` it (explicit "No write",
line 210). So launches are genuinely non-interactive. BUT this is the exact path `mock-worker.ts`
(-> `launchMockAgent` -> `launchTerminalAdapter`) uses, and it STILL yields zero streamed output on
windows-latest — the fix is present but does not fix the runner.

## §6.1 Definition of Done

| Item | Result | Proof inspected |
|---|---|---|
| Lint (biome) clean | PASS | windows/macos/ubuntu `Lint (biome)` step = success (run 27529136706). |
| Typecheck (tsc) clean | PASS | all three `Typecheck` steps = success. |
| Build (turbo) clean | PASS | all three `Build (turbo)` steps = success. |
| Test clean (all OS) | **FAIL** | windows-latest `Test (bun test)` = failure (`@swarm/agent-adapters#test`, 1 fail / 78 expect). mac+ubuntu test steps = success. |
| Cross-platform CI green (win+mac+linux) | **FAIL** | run 27529136706 windows=failure. |
| No banned tokens | PASS | Ran `rg -ni "TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem ipsum" apps packages docs` -> no matches (exit 1, empty). |
| No mock on user path | PASS | tRPC `agents.start` exposes no field to enable the mock; mock requires `SWARM_ENABLE_MOCK_ADAPTER` host env (see #2). |

## Previously-passed parity items — re-confirmed

| ID | Result | Proof inspected |
|---|---|---|
| P01 Parallel execution | PASS (mac/ubuntu) | `host-worker.ts:216-226` launches 3 agents via `Promise.all`, each own PTY+worktree; `host-integration.test.ts:191-203` asserts `maxConcurrent>=2 && concurrencyRatio>=1.5` + per-agent running->done. |
| P02 Worktree isolation | PASS (mac/ubuntu) | `host-integration.test.ts:159-189`: each file present only in its own worktree, absent in all others; base repo on `main`, `git status --porcelain` empty. |
| P03 Agent adapters / real dispatch | PASS (code; mac/ubuntu) | See defect #2 row; real `generic` dispatched via tRPC and asserted `!= mock`. |
| P04 Live status over sync socket | PASS (mac/ubuntu) | `host-integration.test.ts:205-220`: WS subscriber `lastSeq==head==maxSeq`, per-agent running.seq < done.seq. |
| P07 Workspace config setup/teardown | PASS (code; mac/ubuntu) | See defect #3 row. |
| P10 PGlite persistence + sync resume | PASS (mac/ubuntu) | `host-integration.test.ts:222-231`: 20 events + 4 session.exited queried back from PGlite; `host-worker.ts:255-257` WS tail drained to head. |
| P11 Auth (401 without token, loopback) | PASS (mac/ubuntu) | `host-integration.test.ts:140-157`: `httpNoToken==401`, `httpWithToken==200`, `wsRejectedNoToken==true`, loopback `127.0.0.1` + manifest token. |

> Note: every host-side proof (P01/P02/P04/P07/P10/P11 and the P03 real-dispatch tests) is green
> only on macOS+ubuntu. On windows-latest, turbo aborted at `@swarm/agent-adapters#test`; no
> `HOST_RESULT=PASS` / "the host worker run passed" marker appears in the Windows log, so there is
> **no Windows proof** for any host capability on this commit.

## Required fix (must clear before Phase-2 PASS)

1. **Green windows-latest on HEAD.** The mock adapter integration test (`mock-worker.ts` via
   `launchMockAgent` -> `launchTerminalAdapter`) produces zero ConPTY output on the GH Windows
   runner — `node fake-cli.mjs` never streams its token/file. Because the REAL `generic` adapter
   uses the same `launchTerminalAdapter` path, the host P01/P03/P07 proofs are unproven on Windows.
   Fix the ConPTY launch/stream so the command runs and its stdout is captured on windows-latest,
   then re-run the full 3-OS matrix and confirm `@swarm/host:test` executes AND passes on Windows.

## VERIFIED vs READ
- VERIFIED (executed): `gh run watch/view 27529136706` (HEAD CI: win=failure, mac=success,
  ubuntu=success) + failed-step logs (agent-adapters mock-integration fail; no host PASS marker on
  Windows); banned-token ripgrep over `apps packages docs` (empty).
- READ (assessed): orchestrator.ts, trpc.ts, lifecycle.ts, terminal-adapter.ts, mock-adapter.ts,
  mock-worker.ts, pty-supervisor/index.ts, host-worker.ts, host-lifecycle-worker.ts,
  host-integration.test.ts, host-lifecycle.test.ts, mock-adapter.test.ts.
