# Phase 2 wave 1 — CI green on the full OS matrix (evidence §6.2 / §9.2)

Validates the **native PTY dependency** (`@homebridge/node-pty-prebuilt-multiarch`) and the
**real-PTY integration test** (spawns PowerShell + cmd, asserts streamed output + clean
process-tree termination) across all three OSes — the core of ADR-0007a.

- **Commit:** `956786e7d0a95602267420f37834d166873b3dc1`
- **Workflow run:** https://github.com/GhostlyGawd/superset-replica-build/actions/runs/27522109803
- **Overall conclusion:** `success`

| Job | OS | Conclusion |
|-----|----|-----------|
| verify | ubuntu-latest | ✅ success |
| verify | windows-latest | ✅ success |
| verify | macos-latest | ✅ success |

The macOS prebuild (asserted-only during local Windows validation) is now **confirmed** by the
green macOS CI job — node-pty-prebuilt-multiarch installs with prebuilds (no compiler) on win/mac/linux.
Confirmed via `gh run watch --exit-status` (exit 0) + `gh run view`.
