# PARITY.md — Feature Parity Checklist (spec §5)

Every item must end the run as ✅ **verified by evidence** (`evidence/<phase>/`).
Status legend: ☐ not started · ◐ in progress · ✅ verified.

## Core capability parity (1:1 with Superset)
- ✅ **P01 Parallel execution** — many CLI coding agents run at once on one host. _Phase 2; green 3-OS CI run 27536255083 + Critic review-3 PASS; evidence/phase-2._
- ✅ **P02 Worktree isolation** — each task gets its own branch + working dir; agents never interfere. _Phase 2 (ISOLATION integration test); evidence/phase-2._
- ✅ **P03 Agent adapters** — Claude Code, OpenAI Codex CLI, Cursor Agent, Gemini CLI, + generic "any CLI agent" (zero-config). _Phase 2 (real dispatch P03); evidence/phase-2._
- ✅ **P04 Monitoring & notifications** — live status; alert when a workspace needs attention / has changes ready. _Phase 2 (live status over sync); evidence/phase-2._
- ◐ **P05 Built-in terminal** — tabs, split right/down, clear, find, preset slots (Ctrl+1–9), prev/next tab. _Phase 3 B1: xterm.js on @swarm/ui streaming a real host PTY over the terminal-IO WS; local e2e (`content.spec.ts`) + Phase-3 Critic ALL-PASS. ✅ pending 3-OS CI (billing-blocked, ADR-0012)._
- ◐ **P06 Diff viewer + inline editor** — inspect & edit agent changes without leaving the app. _Phase 3 B1: real host git diff + inline save-back (`diffs.writeFile`); local e2e + Critic ALL-PASS. ✅ pending 3-OS CI._
- ✅ **P07 Workspace presets** — setup/teardown scripts (config analogous to `.superset/config.json`). _Phase 2 lifecycle (setup-before / teardown-after); evidence/phase-2._
- ◐ **P08 Open-in-external** — one-click handoff to user's editor/terminal. **Desktop wave B2:** host `workspaces.openExternal({workspaceId, target: editor|terminal|folder})` opens the worktree **on the host** (where it physically lives — works local & remote) cross-platform via `child_process` (`$VISUAL`/`$EDITOR`→`code`/`cursor`; Windows Terminal/`cmd`, macOS `Terminal.app`, Linux `$TERMINAL`/`x-terminal-emulator`; `explorer`/`open`/`xdg-open`); rail/header IconButtons. Also `projects.open` (validates a REAL git repo on the host + seeds a worktree) and `workspaces.create` New/Quick-create dialogs. Evidence: Playwright e2e (`apps/desktop/e2e/b2.spec.ts`) drives open-external (capture seam), New-dialog create, nav prev/next against the real seeded host; host round-trip tests (`apps/host/src/settings-projects.test.ts`). _Pending 3-OS CI (billing-blocked, ADR-0012)._
- ◐ **P09 Workspace navigation** — switch/prev/next, new/quick-create, open project; customizable keyboard shortcuts + settings surface. **Desktop wave B2:** app-level keyboard nav (Ctrl+Alt+↑/↓ prev/next, Ctrl+Alt+N quick-create, Ctrl+, settings) from a single source-of-truth hotkey registry shared by the App shell + TerminalPanel; a host `settings` router persists hotkey overrides in PGlite (`getHotkeys`/`setHotkey`/`setHotkeys`/`resetHotkey`/`resetHotkeys`, scope `desktop`); a `@swarm/ui` Settings dialog lists every shortcut, captures a keystroke to rebind, and resets-to-default with real loading/error states. Evidence: e2e rebinds a shortcut and asserts it persists across reload; host settings round-trip test. _Pending 3-OS CI (billing-blocked, ADR-0012)._
- ✅ **P10 Client/host + real-time sync** — over self-hosted Postgres (PGlite per ADR-0003; no paid cloud DB). _Phase 2 (PERSISTENCE + sync subscriber tests); evidence/phase-2. Desktop client consumes it live (Phase 3)._
- ✅ **P11 Private by default** — explicit connections only; nothing phones home. _Phase 2 (loopback endpoint + bearer auth rejects unauthenticated API/WS); evidence/phase-2._

## Spec additions (beyond original)
- ☐ **P12 Mobile-native control** — full orchestration from the phone (§8).
- ☐ **P13 Self-bootstrap + phone-only remote setup** — stand it up without touching the PC.
- ◐ **P14 Native Windows 10/11 + macOS + Linux** — engine + desktop + full workflow, not WSL-only.
      Built-in terminal hosts Windows shells (PowerShell/cmd/Git Bash/WSL) + Unix shells; user presets run on Windows shells;
      agent process trees killed correctly on every OS; paths/EOL/long-paths handled.
      **Proven by green `windows-latest` CI + Windows e2e evidence.** _Engine: ✅ green windows-latest CI run 27536255083 (Phase 2). Desktop: built + verified on the Windows dev host (clean-install cold gate + local e2e). ✅ full proof pending the Phase-3 3-OS CI run (billing-blocked) + Phase-5 packaged GUI launch._

## Evidence index (filled as items verify)
| ID | Evidence path | Verified |
|----|---------------|----------|
| P01–P04, P07, P10, P11 | green 3-OS CI run 27536255083 · `evidence/phase-2/` · Critic review-3 | ✅ Phase 2 |
| P05, P06 | `evidence/phase-3/` (content.spec e2e, terminal/diff screenshots) · `review.md` ALL-PASS | ◐ pending 3-OS CI |
| P08, P09 | `evidence/phase-3/` (b2.spec e2e, b2-* screenshots, settings-projects host tests) · `review.md` ALL-PASS | ◐ pending 3-OS CI |
| — perf/a11y | `evidence/phase-3/perf-report.md` · `a11y-report.md` (axe 0 critical/serious) | desktop-scope ✅ |
