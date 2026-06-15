# Phase 2 — full host engine GREEN on the 3-OS CI matrix (evidence §6.2 / §9.2 / P14)

The complete host engine — worktree isolation, PTY supervision, agent adapters
(incl. real `generic` dispatch + the test-gated mock), Drizzle/PGlite persistence,
WebSocket event-log sync, and the Hono+tRPC host daemon — passes on **all three OSes**,
including the **parallel-agents integration test** (P01/P02/P04/P10/P11) and the
**real-adapter + workspace-lifecycle** suite (P03 + P07).

- **Commit:** `7d7d0896127cda974ada358a3e181389aa0aa938`
- **Workflow run:** https://github.com/GhostlyGawd/superset-replica-build/actions/runs/27536255083
- **Overall conclusion:** `success`

| Job | OS | Conclusion |
|-----|----|-----------|
| verify | ubuntu-latest | ✅ success |
| verify | windows-latest | ✅ success |
| verify | macos-latest | ✅ success |

## Windows-first proven (not assumed) — P14
The `windows-latest` job runs the full suite cold (install → lint → typecheck → build →
`bun test`), including: the real-PTY `pty-supervisor` integration (spawn PowerShell + cmd,
stream ANSI, resize, tree-kill the process tree), the `agent-adapters` mock-over-PTY e2e,
the **3-parallel-agents** host integration (isolation + live status + PGlite persistence +
bearer-token auth), and the **real `generic` adapter dispatch + P07 setup/teardown** lifecycle.

## Cross-platform hardening that got us here (see DECISIONS ADR-0011 + evidence/phase-2/ci-fixes.md)
- Agents spawn **directly** in the PTY (node-pty), exit code from `onExit` — never a shell-wrapped child whose stdout must traverse the GH-runner ConPTY.
- `node` resolved via `process.execPath` (no PATH/`where` lookup in spawned workers).
- Test workers flush their verdict then `process.exit`; the test runner uses async spawn + tree-kill (no `spawnSync`-timeout reliance).
- Windows file-lock resilience: bounded `fs.rm({force,maxRetries})` + transient git retries.
- P07 lifecycle setup/teardown run via plain `node:child_process` (no PTY needed for batch commands).
- The whole monorepo uses explicit `.ts` import extensions (Node strip-types workers) and a cache-disabled (`turbo --force`) commit gate.

Confirmed via `gh run watch --exit-status` (exit 0) + `gh run view`.
