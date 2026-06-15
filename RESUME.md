# RESUME — fresh-chat handoff (Grove / Superset replica)

**Read this + `STATE.json` + `DECISIONS.md` + `PARITY.md` + `RUBRIC.md` + latest `evidence/` to re-derive everything. Do NOT rely on chat history.**

- Product: **Grove** — 1:1 cross-platform OSS replica of Superset (parallel CLI-agent orchestration over isolated git worktrees).
- Repo: `github.com/GhostlyGawd/superset-replica-build` · Linear project "SWARM — Superset Replica" (`a778bfa7-a33c-4069-b217-33169206345d`).
- Workspace: `D:/GitHub Projects/superset-replica-build`. Toolchain: bun, node 24, gh, rg, caddy (all installed). No Docker (PGlite substitutes — ADR-0003).

## Shipped
- **v0.1.0** Phase 0 (recon + architecture + skeleton; 3-OS CI green).
- **v0.2.0** Phase 1 (Grove brand + `@swarm/ui` design system; anti-slop Critic PASS).
- **v0.3.0** Phase 2 (cross-platform **host engine** — worktree isolation, node-pty agent supervision, adapters, PGlite persistence, WS sync, secure Hono+tRPC daemon; parallel-agents proof P01/P02/P04/P10/P11 + real dispatch P03 + lifecycle P07 **green on Windows+macOS+Linux**, run 27536255083; Critic review-3 PASS; zero quarantines). Linear P01-P04/P07/P10/P11 = Done.

## CURRENT — Phase 3 (Desktop Client) is CODE-COMPLETE + Critic ALL-PASS. **ONLY blocker to v0.4.0 = GitHub Actions BILLING (NOT code) — see ADR-0012. HEAD `debcd76`.**

### THE ONE THING TO DO: fix GitHub Actions billing (user action), then this auto-completes
When billing is restored (raise the Actions spending limit / fix payment at github.com/settings/billing **OR** make the private repo public → free unlimited Actions, aligns with the OSS-replica goal), push/re-run CI and **confirm the `verify` 3-OS matrix + the new `e2e (desktop, ubuntu)` job are GREEN**, then: cut **v0.4.0** (CHANGELOG + tag), move Linear **P05/P06/P08/P09 → Done**, and start **Phase 4 (mobile PWA)**. Everything below item 1 is already DONE this session.
1. **PRIORITY 1 — RESOLVED as a diagnosis; the blocker is now EXTERNAL/BILLING (user action).** `0575214` was NOT a code defect. The clean-install hypothesis below was **REFUTED** this session: a full clean-install repro on Windows (`rm -rf` all node_modules + `.turbo` + `*.tsbuildinfo`, `bun install --frozen-lockfile`, then `bun run lint` → `typecheck` → `build` → `test`) is **ALL GREEN cold** (install ✓, lint ✓ 166 files, typecheck ✓ 17/17, build ✓ 17/17, test ✓ 9/9 incl. all real PTY/host/worktree/diff integration). The RED CI is the **GitHub Actions spending-limit/payment block** — both Phase-3 runs (`27539598023`, `27541523156`) failed with *"the job was not started because recent account payments have failed or your spending limit needs to be increased"* on all 3 OSes (jobs never started → no logs → the prior `gh BlobNotFound`). Repo is **private** → metered Actions minutes. **This needs USER action and cannot be fixed in-repo:** raise the Actions spending limit / fix payment at github.com/settings/billing, OR make the repo public (free unlimited Actions; aligns with the OSS-replica goal — user's publish call). Until CI runs green again, **no version may be cut** (the 3-OS-CI non-negotiable stands). The **clean-install cold repro is the interim gate** for staged work (Windows-only proxy; mac/Linux unverifiable locally).
   - _(historical, now refuted) clean-install-defect hypothesis: an incremental-cache-masked type error / missing committed file / workspace-resolution issue. Disproven by the all-green cold repro above._
2. ✅ **DONE this session — Wave B2 landed** (`c1455b3`): workspace nav (prev/next Ctrl+Alt+↑/↓, quick-create Ctrl+Alt+N, New-worktree + Open-project dialogs), **open-in-external as a HOST procedure** `workspaces.openExternal` (editor/terminal/folder, cross-platform via child_process — opens the worktree where it physically lives; ADR-0013), customizable shortcuts + Settings dialog backed by a host `settings` router (hotkeys persisted in PGlite), all on `@swarm/ui` + the REAL host. Verified by a full clean-install cold gate + product e2e 8/8.
3. ✅ **DONE this session** — **e2e CI job** added (`e2e (desktop, ubuntu-latest)`: playwright chromium + the real-host desktop e2e); **QA screenshots** (desktop + phone-width) in `evidence/phase-3/`; **perf-report.md** + **a11y-report.md** produced (a11y 1 critical + 2 serious FOUND and FIXED → 0/0; `@swarm/ui` Tabs aria-controls guard + AA contrast tokens + sr-only h1); **independent Phase-3 Critic re-gate** (`evidence/phase-3/review.md`) = **ALL-PASS (release-ready pending billing)**, §6.3 design bar PASS. _Gotcha logged: a QA spec committed after the B2 clean-install typecheck slipped a TS error past the gate (caught by the Critic) → re-gate ALL pushed HEADs with a clean install, not just the feature commit._

## Remaining roadmap (§4)
- **Phase 4** Mobile-native PWA (installable, offline-first, Web Push/VAPID, gestures, safe-area, 60fps; full agent-orchestration control from the phone) → v0.5.0.
- **Phase 5** Platform & self/remote setup (one-command bootstrap on Win/mac/Linux; Electron installers NSIS/dmg/AppImage via electron-builder; phone-only remote path; cloudflared/localtunnel + Caddy) → v0.6.0.
- **Phase 6** Hardening & launch: full e2e green on 3 OSes; **produce the §6.2/§6.4 reports the Phase-2 Critic flagged as missing — performance report + recorded speed budgets (terminal-stream latency, interaction latency, cold start) + a license-audit report**; accessibility; security; docs incl phone-only path; `docs/demo.md`; **HANDOFF.md** → cut **v1.0.0** when all §9 exit conditions pass with evidence.

## Hard-won gate discipline (ADR-0011 + addendum)
- **Local `turbo --force` ≠ CI.** Gate app/desktop changes with a **CLEAN install** (rm node_modules + `*.tsbuildinfo` + `.turbo`, `bun install --frozen-lockfile`, then CI's exact steps). Always confirm the 3-OS CI run after pushing.
- Monorepo: explicit `.ts` import extensions + `allowImportingTsExtensions` (Node strip-types workers).
- Windows engine discipline: spawn agent processes **directly** in the PTY (node-pty) with `onExit`; resolve `node`→`process.execPath` (no PATH/`where` in spawned workers); run **batch** commands via `child_process` (not a PTY); test workers flush-then-`process.exit`; bounded `fs.rm({force,maxRetries})` + async-spawn/tree-kill; never rely on Node executing `.ts` or a shell forwarding a child's stdout through ConPTY on the GH Windows runner.
- Playwright: on Windows run via **node, not bun**; CI must `playwright install` browsers before any e2e. Electron: `ELECTRON_SKIP_BINARY_DOWNLOAD=1` in CI (build/typecheck only; GUI launch verified locally + packaged Phase 5).
- Every phase ends with an **independent Critic (fresh context, did NOT build it)**; for feature-UI phases include the §6.3 design bar + screenshots. No banned tokens; no mocks on user happy paths.

## Harness (recursive-harness) housekeeping
- Open predictions to score once resolved: `ec5bd054` (desktop foundation), `0dce6bdf` (B1 terminal/diff), `4927acf5` (B2 nav). Score with `python <harness>/bin/harness outcome <id> --result hit|miss --notes "..."`.
- Follow-up `7c07bf` (and queued in this file): run `/retro` → `/harness-pr` to route the CI-gate lessons (turbo-cache false-green → `--force`; **`--force` ≠ CI → clean-install gate**; Windows ConPTY discipline; fresh independent Critics catch fakes) into harness artifacts. Do at a clean phase boundary.
