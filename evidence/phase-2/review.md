# Phase 2 (Host Engine) — Critic Review

Critic did NOT build this. Graded from request + RUBRIC.md + PARITY.md + artifacts only
(no builder chat/reasoning was provided). Verified mechanically where possible.

**Commit reviewed:** `17c0091` (HEAD of `main`). **Date:** 2026-06-15.

## Overall verdict: FAIL

Two independent §6.1 blockers: (1) the authoritative `windows-latest` CI job is RED on this
exact commit, and (2) the only agent-execution path the engine exposes runs the keyless mock,
which is reachable and effectively un-gated on the user happy path. Either alone blocks the phase.

Counts: **PASS 5 · FAIL 3 · PARTIAL 2 · PENDING 0.**

---

## §6.1 Definition of Done

| Item | Result | Proof inspected |
|---|---|---|
| Build / Biome lint / tsc clean | PASS | windows+macos+ubuntu CI all passed build/lint/typecheck steps; failure was only at the test step (run 27525968919). |
| Real tests pass (unit+integ+e2e) | FAIL | `@swarm/agent-adapters` has 2 failing tests on `windows-latest` CI: `mock adapter integration … running->done` and `detectAdapter … resolves to available`. No Playwright e2e exists (no client UI yet — in scope per task). |
| It actually runs (real host) | PASS* | Host integration test PASS on ubuntu+macOS CI and locally on Windows (I ran `bun test src/host-integration.test.ts` → 8 pass / 0 fail / 13.75s). *Did NOT execute on the Windows CI job (turbo aborted after agent-adapters failed; `@swarm/host:test` group opened with zero test output). |
| No banned tokens | PASS | I ran the §6.1 ripgrep over `apps packages docs` → empty. |
| Cross-platform CI green (win+mac+linux) | FAIL | run 27525968919: `verify(ubuntu)`=success, `verify(macos)`=success, `verify(windows)`=**failure**. §6.1: "a red Windows job = NOT done." Blocks P14. |
| No mock masquerading on a user path | FAIL | `orchestrator.ts:223-232` always calls `launchMockAgent({ enable: options.enableMock ?? true })`; tRPC `agents.start` (`trpc.ts:85-99` → `startAgentInWorkspace`) passes no `enableMock`, so `enable` defaults `true`. The mock runs on the API path regardless of the `SWARM_ENABLE_MOCK_ADAPTER` gate. |
| CHANGELOG updated / committed | PASS | CHANGELOG.md [Unreleased] documents waves 1–3b; committed. |

## §6.4 Quality dimensions (applicable now)

| Dimension | Score | Note |
|---|---|---|
| Backend design | PASS | Single-writer event-log, typed `Result`s, branch-per-task worktree engine, PTY supervisor w/ tree-kill, PGlite-backed `EventLogStore` seam. Clean. Caveat: orchestrator hardcodes `adapterId:"mock"` — no real-adapter dispatch. |
| Tooling | PASS | Turbo, Biome, tsc, bun, node 24, `@homebridge/node-pty-prebuilt-multiarch`, drizzle/pglite. |
| Functionality | FAIL | Engine cannot launch any real adapter (Claude/Codex/Cursor/Gemini/generic); `agents.start` ignores adapter selection and always runs the mock. Windows tests red. |
| Performance | PARTIAL | Parallel proof carries timings (wall 2420ms / sum 6193ms / ratio 2.56) but no §6.4 speed-budget report (interaction/terminal-stream/cold-start) in evidence. |
| Security | PASS | Loopback bind default (`server.ts:21` `127.0.0.1`); bearer-token middleware 401s `/trpc/*` (`server.ts:138-143`); WS upgrade gated (`server.ts:162`, `authorizeRequest`); no telemetry/outbound. Minor: token check is `!==`, not constant-time despite "constant-time-ish" comment. |
| Docs | PARTIAL | CHANGELOG + ADRs + per-package evidence are thorough, but `host-integration.md` and CHANGELOG claim a GREEN full-tree Windows gate that the authoritative Windows CI contradicts for the same commit. |

## Parity items

| ID | Result | Proof inspected |
|---|---|---|
| P01 Parallel execution | PASS | REAL. `host-worker.ts:214-219` launches 3 agents via `Promise.all`, each a real `node fake-cli.ts` in its own node-pty PTY (`terminal-adapter.ts:114-124` → `pty-supervisor/index.ts:89` `nativeSpawn`). Interval-sweep `maxConcurrent=3`, ratio 2.56; assertion `host-integration.test.ts:188-200` requires `maxConcurrent>=2 AND ratio>=1.5 AND per-agent running→done` — meaningful, not serialized. I reproduced 8/8 locally. (Caveat: it is the mock agent running in parallel, since real adapters aren't wired.) |
| P02 Worktree isolation | PASS | REAL. `git-worktree/index.ts:470-479` `git worktree add -b <branch> <path> <base>` via execFile (no shell). `host-integration.test.ts:156-186` independently checks on disk: each file present only in its own worktree, absent in every other, base repo on `main` and `git status --porcelain` empty. |
| P03 Agent adapters | FAIL | Library is real (universal `terminal-adapter` PTY launch; presets with PATH-detection + honest `not_found`; `detectAdapter` never fakes). But `launchTerminalAdapter` is reachable ONLY via `launchMockAgent` (grep: no other caller). The orchestrator/tRPC cannot dispatch any named/real adapter; `agents.start` has no `adapterId` input and always runs the mock. + mock un-gated on user path (see §6.1). |
| P04 Monitoring/live status | PASS | Streamed over real WS, not polled. `SyncClient` over `webSocketTransport` (`host-worker.ts:164-181`); `host-integration.test.ts:202-217` asserts running.seq<done.seq per agent and `lastSeq==head==maxSeq`. |
| P07 Workspace presets/config | PARTIAL | `SwarmConfig` schema + `parseConfig`/`mergeConfig` validator is real and tested (`config/index.ts`). But `@swarm/config` is NOT a dependency of `apps/host` and is never imported by the orchestrator — setup/teardown commands are never executed by the engine. |
| P10 Client/host + sync + PGlite | PASS | PGlite real (`db/store.ts:5` `@electric-sql/pglite` + drizzle/pglite migrations; `postgres://` selects real PG). Resume real (`sync/client.ts`: resume token, `lastSeq` cursor, BATCH catch-up + live tail, ACK, gap-detect at line 219). Persistence asserted: 20 events queried back from PGlite. "Self-hosted Postgres = PGlite-in-WASM" (ADR-0003) is honest. |
| P11 Private-by-default / auth | PASS | Verified by test: `httpNoToken=401`, `httpWithToken=200`, `wsRejectedNoToken=true` (`host-integration.test.ts:149-154`). Loopback default + manifest token; no telemetry. |

## Required fixes (must clear before v0.3.0)

1. **Green the `windows-latest` CI job** on HEAD. Fix the 2 failing `@swarm/agent-adapters` tests
   (mock-PTY integration + `detectAdapter`→available) on the GitHub Windows runner — they pass
   locally but fail in CI, so they are environment-brittle for a project claiming Windows-native
   support. Re-run the full 3-OS matrix and confirm `@swarm/host:test` actually executes on Windows.
2. **Close the mock-on-user-path hole.** Make `agents.start` select a real adapter (add `adapterId`
   + dispatch to `launchTerminalAdapter`/presets), and stop defaulting `enable` to `true` in
   `orchestrator.launch` — require the explicit env/flag so the mock cannot run on the API path.
3. **Correct the evidence.** `host-integration.md` / CHANGELOG claim a GREEN Windows full-tree gate
   that the authoritative CI contradicts for the same commit. Align prose with the gate.
4. (Lower) Wire `@swarm/config` setup/teardown into the orchestrator, or scope P07 down explicitly.
   (Lower) Make the bearer-token comparison constant-time or drop the "constant-time-ish" comment.

## What was VERIFIED vs READ
- VERIFIED (executed): banned-token scan (empty); `bun test` host-integration locally on Windows
  (8/8); `bun test` agent-adapters locally (35/35, both fail only in CI); `gh run view` for HEAD CI
  (windows=failure, mac/ubuntu=success) + failed-step logs + absence of host test output on Windows.
- READ (assessed, not executed): orchestrator/server/trpc/adapters/pty/worktree/db/sync/config source.
