# Phase 2 (Host Engine) — Critic Review 3 (FINAL GATE)

Critic: independent (did NOT build this). Verified mechanically where possible.
Commit under test: 7d7d089 (HEAD of main). Authoritative CI run: 27536255083 (success). Date: 2026-06-15.

Contamination note: the review brief told me what I "should" find (NO windows skip; the fixes were real). I graded adversarially from the artifacts + a local Windows test run + the raw CI logs.

## 3-OS CI for HEAD (7d7d089, run 27536255083)
| OS | Job conclusion | Test step | Proof |
|----|----------------|-----------|-------|
| ubuntu-latest | success | Test (bun test) success | job 81386343689 |
| macos-latest | success | Test (bun test) success | job 81386343724 |
| windows-latest | success | Test (bun test) success (32s) | job 81386343696 |

windows-latest log (job 81386343696) shows the host suite GENUINELY RAN, not skipped: "(pass) PARALLELISM (P01)", "(pass) ISOLATION (P02)", "(pass) tRPC COMMAND PATH (P03 real dispatch) ran a REAL adapter", "(pass) P07 setup BEFORE / teardown AFTER", plus "pty-supervisor powershell [22446ms]" and "mock adapter integration (real PTY via Node worker)" then "Ran 12 tests across 2 files. [30.62s]".

I also re-ran the full suite locally on Windows 10 with the cache busted (turbo run test --force): 8/8 task suites pass (host 12, git-worktree 9, agent-adapters 39, pty-supervisor 4 real-PTY, shared 4, config 9, sync, ui).

## Section 6.1 Definition of Done
| Item | Result | Proof inspected |
|------|--------|-----------------|
| Builds clean | PASS | CI Build (turbo) success on all 3 OS (run 27536255083). |
| Biome lint clean | PASS | CI Lint success on all 3 OS. |
| tsc typecheck clean | PASS | CI Typecheck success on all 3 OS. |
| Real tests pass (unit+integration) | PASS | Local (forced) + CI: host integration/lifecycle are REAL (spawn Node worker -> real host Hono+tRPC+WS+PGlite, real PTYs). Not assertion-free smoke. |
| It actually runs (real host engine) | PASS | host-worker.ts boots the real daemon; 4 agents (3 mock-on-real-PTY + 1 real generic via tRPC) run end-to-end; asserted on disk + over the wire. |
| No banned tokens | PASS | rg -ni TODO/FIXME/XXX/HACK/etc over apps packages docs -> empty. |
| Cross-platform CI green (win+mac+linux) | PASS | All three jobs success for HEAD; windows Test step ran the full real-PTY suite. |
| No mock masquerading as a feature | PASS | See P03. Mock needs adapterId==mock AND a flag (enableMock or SWARM_ENABLE_MOCK_ADAPTER); tRPC never forwards enableMock, so the API path needs the host env var (test/dev gate) — never on a user happy path. |
| CHANGELOG updated / committed | PASS | CHANGELOG.md documents Phase-2 waves 1-3 + critic-gate fixes; HEAD committed, branch clean. |
| Playwright e2e + desktop/phone screenshots | DEFERRED (N/A this phase) | No client exists yet — Phase 3 (desktop) / Phase 4 (mobile) not_started per STATE.json. The client exercising the host this phase is the integration harness. |

## Parity items
| ID | Result | Proof inspected |
|----|--------|-----------------|
| P01 Parallel execution | PASS (REAL) | host-worker.ts:217-228 launches 3 agents via Promise.all; each mock spawns a REAL node fake-cli.mjs in its OWN ConPTY (mock-adapter.ts:87-98 -> launchTerminalAdapter -> supervisor.spawnProcess). host-integration.test.ts:202-214 asserts maxConcurrent>=2 (interval sweep) AND concurrencyRatio>=1.5 AND wallMs<sumMs AND per-agent running->done. Passed on windows-latest. |
| P02 Worktree isolation | PASS (REAL) | Branch+dir per task via WorktreeEngine. host-integration.test.ts:170-200 checks on disk that each file is present ONLY in its own worktree, ABSENT in every other, base repo on main with empty git status --porcelain. Reinforced by git-worktree "a file written in one worktree does not appear in the other". |
| P03 Agent adapters / real dispatch | PASS (REAL) | Real PTY direct spawn (terminal-adapter.ts:193-280 -> spawnProcess, node-pty). 4th agent via tRPC agents.start (adapterId=generic, command=node) runs a real CLI; host-integration.test.ts:244-255 + host-lifecycle.test.ts:115-124 assert adapterId==generic and not mock, status done. Presets degrade via detectAdapter (not_found/unknown, never faked). Mock gating: orchestrator.ts:260-274 requires explicit adapterId (throws if undefined; no nullish-true default), mock needs selection==mock AND isMockAdapterEnabled. Proven on windows-latest. |
| P04 Monitoring / live status | PASS (REAL) | host-integration.test.ts:216-231: WS subscriber over the real socket; liveOverWs.lastSeq==head==maxSeq (no gaps) and per-agent running.seq < done.seq. |
| P07 Workspace presets | PASS (REAL) | lifecycle.ts EXECUTES .grove/config.json commands via node:child_process (cmd.exe /d /s /c, sh -c), real exit codes. Orchestrator runs setup BEFORE launch (orchestrator.ts:335-345), teardown AFTER session end (:413-427,:490-495). host-lifecycle.test.ts:126-141 proves max(setupSeqs) < startedSeq and min(teardownSeqs) > exitedSeq; setup marker carries injected SWARM_WORKSPACE_NAME. |
| P10 Client/host + sync + self-hosted Postgres | PASS (REAL) | packages/db/store.ts uses real @electric-sql/pglite via Drizzle (auto-migrate; DATABASE_URL selects PGlite or real Postgres). host-integration.test.ts:233-242 queries back 20 events + 4 session.exited from PGlite. WS resume tokens + gapless catch-up proven in packages/sync/client.test.ts (applied==[1,2,3,4], no gaps/dupes). |
| P11 Private by default | PASS (REAL) | server.ts:138-143 401s any /trpc/* without the exact bearer; WS gated by same token (:155-163,:76-85); loopback 127.0.0.1 default; 256-bit manifest token. host-integration.test.ts:163-168 asserts 401/200/ws-reject. Telemetry grep -> empty. |
| P14 Windows-first | PASS (REAL) | windows-latest job 81386343696 success running the FULL real-PTY suite: "Ran 12 tests across 2 files [30.62s]" incl. P01/P02/P03/P04/P07/P10/P11 + 22.4s real PowerShell PTY + cmd + real-PTY mock. NO test is windows-skipped. |

## Windows-skip audit
rg for skipIf / test.skip / it.skip / describe.skip / .todo / process.platform over apps packages -> only legitimate OS-adaptation branches (shell selection, path-case compare, taskkill vs SIGKILL). Zero test skips of any kind. No quarantine to fake green.

## Section 6.4 Dimension notes
- Backend design: PASS. Single-writer host; append-only event log with monotonic seq; PGlite default + optional Postgres; clean package boundaries; PTY layer isolated to Node (ADR-0007a) with a documented, fixed root-cause for the Windows ConPTY stall.
- Tooling/language: PASS. Bun + Node-24 PTY runtime, Turborepo, Biome, tRPC/Hono, Drizzle — all real, no escape hatches; typecheck clean.
- Functionality: PASS. Core capability (parallel isolated agents + live status + persistence + auth + lifecycle) proven end-to-end on all 3 OS.
- Security: PASS. Bearer-token on HTTP + WS, loopback bind, no telemetry. (Token compared with strict equality, not constant-time — acceptable for loopback; note for Phase 6 if exposed via tunnel.)
- Docs: PASS for the engine (CHANGELOG, DECISIONS/ADRs, evidence/*).

## Gaps (non-blocking for Phase 2; track for Phase 6 launch gate)
- Section 6.2/6.4 mandate a performance report, license-audit report, and recorded speed budgets (terminal-stream latency, cold start). NONE exist under evidence/phase-2/. Engine-relevant latency/cold-start budgets are unmeasured. Consistent with the Phase-6 (hardening/launch) deferral and the phase-1 a11y deferral, so not blocking the host-engine gate — but must be closed before final sign-off.

## VERDICT: PASS
Phase 2 (Host Engine) is genuinely and honestly done. No fake work, no mock on the user/API path, no quarantined/skipped Windows test. P01 parallelism and P02 isolation are REAL (on-disk + wall-time ratio), the real generic adapter is proven on windows-latest, and the 3-OS CI is green on HEAD. Verified by an independent local Windows re-run AND the raw windows-latest CI log. Open item: perf/license/speed-budget evidence (deferred to Phase 6).
