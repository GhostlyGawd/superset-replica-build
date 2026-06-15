# PARITY.md — Feature Parity Checklist (spec §5)

Every item must end the run as ✅ **verified by evidence** (`evidence/<phase>/`).
Status legend: ☐ not started · ◐ in progress · ✅ verified.

## Core capability parity (1:1 with Superset)
- ☐ **P01 Parallel execution** — many CLI coding agents run at once on one host.
- ☐ **P02 Worktree isolation** — each task gets its own branch + working dir; agents never interfere.
- ☐ **P03 Agent adapters** — Claude Code, OpenAI Codex CLI, Cursor Agent, Gemini CLI, + generic "any CLI agent" (zero-config).
- ☐ **P04 Monitoring & notifications** — live status; alert when a workspace needs attention / has changes ready.
- ☐ **P05 Built-in terminal** — tabs, split right/down, clear, find, preset slots (Ctrl+1–9), prev/next tab.
- ☐ **P06 Diff viewer + inline editor** — inspect & edit agent changes without leaving the app.
- ☐ **P07 Workspace presets** — setup/teardown scripts (config analogous to `.superset/config.json`).
- ☐ **P08 Open-in-external** — one-click handoff to user's editor/terminal.
- ☐ **P09 Workspace navigation** — switch/prev/next, new/quick-create, open project; customizable keyboard shortcuts + settings surface.
- ☐ **P10 Client/host + real-time sync** — over self-hosted Postgres (PGlite per ADR-0003; no paid cloud DB).
- ☐ **P11 Private by default** — explicit connections only; nothing phones home.

## Spec additions (beyond original)
- ☐ **P12 Mobile-native control** — full orchestration from the phone (§8).
- ☐ **P13 Self-bootstrap + phone-only remote setup** — stand it up without touching the PC.
- ☐ **P14 Native Windows 10/11 + macOS + Linux** — engine + desktop + full workflow, not WSL-only.
      Built-in terminal hosts Windows shells (PowerShell/cmd/Git Bash/WSL) + Unix shells; user presets run on Windows shells;
      agent process trees killed correctly on every OS; paths/EOL/long-paths handled.
      **Proven by green `windows-latest` CI + Windows e2e evidence.**

## Evidence index (filled as items verify)
| ID | Evidence path | Verified |
|----|---------------|----------|
| —  | (pending)     | —        |
