# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Desktop client foundation (Phase 3).** `apps/desktop`: Electron shell (secure preload, `contextIsolation`+`sandbox`, no `nodeIntegration`) + Vite React renderer on `@swarm/ui` — a dark-first operator cockpit (workspace rail, content pane, status bar) with real loading/empty/error/connect states. Connects to the **real** host via `~/.grove/host/manifest.json` (endpoint+token; `GROVE_HOST_URL`/`GROVE_HOST_TOKEN` dev fallback), makes live tRPC `host.status`/`workspaces.list` calls, and subscribes to agent status over the sync WebSocket. Playwright renderer smoke runs against a real host (starts `startHost` + PGlite + PtySupervisor, seeds worktrees).
- **Desktop terminal + diff viewer (Phase 3, P05/P06).** Terminal panel — xterm.js (`@xterm/*`) inside `@swarm/ui` `TerminalFrame`: tabs, split right/down, clear, find, preset slots `Ctrl+1–9`, prev/next tab; streams a **real** host PTY over a new bearer-gated `/terminal` WebSocket (`apps/host/src/terminal-server.ts`; shared `PtySupervisor`; out-of-band from the sync event log). Diff viewer + **inline editor** — real git diff via a new `diffs` tRPC router + `WorktreeEngine` `changes`/`fileDiff`/`writeFile`/`discardFile`; inline edits save back to the worktree. Playwright e2e (4/4) drives terminal streaming + diff edit against a real host.

### Changed
- `apps/host` serves permissive CORS on `/trpc` (mounted before the bearer guard so preflight isn't 401'd) so browser clients (the desktop renderer + the Phase-4 PWA) can connect — the bearer token, not origin, remains the gate.
- CI skips the Electron binary download (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`; Electron kept out of bun `trustedDependencies`) — CI only builds/typechecks + Playwright-tests the renderer headlessly; GUI launch is verified locally and packaged in Phase 5. Root `@types/node` pinned via `overrides` to resolve an Electron/`bun-types` version collision.

## [0.3.0] - 2026-06-15

Phase 2 — cross-platform host engine: worktree isolation, PTY agent supervision, agent adapters (real + a strictly test-gated mock), Drizzle/PGlite persistence, WebSocket event-log sync, and a secure Hono+tRPC host daemon. The parallel-agents integration proof (P01/P02/P04/P10/P11), real `generic` adapter dispatch (P03), and workspace lifecycle (P07) are **green on Windows + macOS + Linux** (CI run 27536255083) — Windows proven by root-cause fixes, not quarantines.

### Added
- **Host engine — PTY supervisor (Phase 2 wave 1).** `packages/pty-supervisor`: real `PtySupervisor` (spawn/write/onData/resize/kill, per-session PID tracking + tree-kill) over `@homebridge/node-pty-prebuilt-multiarch`, with a real-PTY integration test (spawns PowerShell + cmd, asserts streamed output and clean process-tree termination). CI gains `setup-node`.
- Completed `@swarm/api` tRPC surface to all 13 routers of architecture §3.1 (sessions, presets, ports, notifications, settings, host, auth + completed config/diffs/workspaces/agents/terminal).
- `SwarmConfig` (`packages/config`) reshaped to ordered `Command[]` for setup/teardown/run with per-OS shell support (PowerShell/cmd/bash/sh/zsh/wsl) + per-field before/after overlay + zero-dep validator (9 tests).
- **Host engine — worktree, persistence, sync (Phase 2 wave 2).** `packages/git-worktree`: real `WorktreeEngine` over native git (create/list/status/remove/prune/import; branch-per-task on a shared object store; Windows path + `core.longpaths` handling; isolation-proven tests). `packages/db`: Drizzle schema (13 tables incl. an append-only `events` log with a gapless monotonic seq) over **PGlite** with auto-run migrations and `DATABASE_URL` selecting PGlite or a real Postgres. `packages/sync`: WebSocket event-log sync — single-writer append + live fan-out, resume-token catch-up, and a reconnect/backoff client proven to resume with no gaps/dupes (browser-safe `.` entry + Node-only `@swarm/sync/server`).
- **Agent adapters (Phase 2 wave 3a).** `packages/agent-adapters`: a zero-config universal terminal adapter (runs any CLI agent in a PTY, infers running/needs-attention/done/error status via an exit-code sentinel) + named presets for Claude Code / Codex CLI / Cursor Agent / Gemini CLI (with PATH-detection + graceful degradation when a CLI is absent — never faked) + a flag-gated headless **mock adapter** (drives a real fake-CLI over PTY for keyless e2e). Zero external deps.
- **Host daemon + orchestration (Phase 2 wave 3b).** `apps/host`: a Hono server exposing `@swarm/api` over tRPC and the `@swarm/sync` WebSocket hub on one **127.0.0.1** loopback port, gated by a 256-bit **bearer token** written to a manifest at `~/.grove/host/manifest.json` (private-by-default, no telemetry — P11). Orchestration wires worktree → PTY agent (Node) → DomainEvents → sync event-log → PGlite. **Integration test proves the core capability (P01+P02+P04+P10+P11):** 3 mock agents run in parallel (wall-time ratio ≈2.56, all `running` before any `done`) on isolated worktrees with no cross-interference, live status streamed over the real socket, events persisted in PGlite, and unauthenticated calls rejected (401).

### Changed
- **ADR-0007a:** the PTY layer / host engine runs under **Node**, not Bun — Bun tears down the ConPTY `net.Socket` on Windows. Validated node-pty + the multiarch fallback on Node 24 across the OS matrix.

### Fixed
- **Phase-2 critic gate (P03 real dispatch + strict mock-gating).** `agents.start` (tRPC) and `Orchestrator.launch` now take an explicit **adapter selection** (`claude-code | codex-cli | cursor-agent | gemini-cli | generic | mock`; `generic` + an explicit command) and dispatch the chosen **real** adapter over `launchTerminalAdapter`/the PTY supervisor. The `?? true` mock default is removed: the keyless **mock is reachable ONLY when `adapterId==="mock"` AND a test/dev flag is set** (`SWARM_ENABLE_MOCK_ADAPTER` or an explicit `enableMock:true`) — never on the API/user happy path (RUBRIC §6.1). The host integration test's 4th (tRPC) agent now runs a **REAL `generic` adapter** end-to-end (worktree → PTY → events → PGlite → `done`).
- **Phase-2 critic gate (P07 setup/teardown executed).** `@swarm/config` is now an `apps/host` dependency; the orchestrator loads `<repo>/.grove/config.json` and **executes** its `setup` commands (per-OS shell, workspace env-vars injected) BEFORE the agent launches and `teardown` AFTER the session ends, streaming output as bounded `workspace.lifecycle` events. New `host-lifecycle.test.ts` proves setup runs before the agent (marker file + setup events precede `session.started`) and teardown after (`session.exited`), and independently proves the real `generic` dispatch path.
- **Phase-2 critic gate (Windows CI robustness).** The mock fake-CLI is now a self-contained **`fake-cli.mjs`** (no TypeScript, no `.ts` imports) invoked as `node fake-cli.mjs`, fixing unreliable Node strip-types `.ts` execution inside a PTY on `windows-latest` (ADR-0011); a lock-step test pins its inlined protocol constants to `mock-protocol.ts`. `detectAdapter` now short-circuits absolute paths via `existsSync` and parses `where.exe`/`which` defensively (first existing absolute line, `.exe/.cmd/.bat`, trim CR, never throws); its test probes a **guaranteed-present** absolute binary (`process.execPath`). **Root cause of the Windows-only stall:** the terminal adapter *typed* the launch command into an *interactive* PowerShell PTY, and PSReadLine re-rendered/wrapped the long absolute-path line on the GH runner so it never executed. Fixed by launching **non-interactively** — the command is passed as a process argument to `powershell -NoProfile -NonInteractive -Command` / `cmd /d /c` / `sh -c` (PTY still allocated; exit-sentinel + status inference unchanged); the host P07 lifecycle runner uses the same mechanism, so real agent launches are robust on Windows (P14).
- Cross-platform test robustness (caught by the Windows + macOS CI jobs): worktree `import`/`samePath` now canonicalize real paths via `fs.realpathSync.native`, so adopting an external worktree is stable across macOS symlinked temp dirs (`/var`→`/private/var`) and Windows short-paths/drive-letter casing; the PTY integration test polls (bounded) for the spawned child PID before asserting tree-kill, removing CI timing flakiness.
- Windows file-lock resilience: `@swarm/git-worktree` engine + fixtures retry only *transient* git failures (errno/stderr-signature allowlist; deterministic errors surface immediately) up to 5× with backoff — git operations no longer flake under heavy parallel load (`index.lock`/in-use-handle/AV contention). See ADR-0011.

### Changed (build)
- Standardized the monorepo on **explicit `.ts` import extensions** + `allowImportingTsExtensions` in `tsconfig.base.json` (valid under `noEmit`; required for the Node strip-types PTY workers per ADR-0007a). Adopted a cache-disabled commit gate (`bunx turbo run … --force`) after discovering Turbo cache could mask failures locally (ADR-0011).

## [0.2.0] - 2026-06-14

Phase 1 — Brand & Design System. Independent anti-slop design gate passed (Critic 5/5 §6.3, 0 fail); CI green on Windows + macOS + Linux.

### Added
- **Brand & design system (Phase 1).** Product named **Grove** (ADR-0010). `docs/brand/` (name, story, voice, hand-authored SVG mark + wordmark) and `docs/design-system.md` (thesis "calm surface, swarming depth"; IBM Plex Sans/Mono type scale; dark+light themes; triple-encoded agent-state color semantics; spacing/radii/elevation tokens; motion language + reduced-motion).
- **`@swarm/ui` primitive component library** (`packages/ui`): tokens (CSS vars + typed TS export) + Tailwind v3.4 preset + accessible React primitives (Button, Input, Select, Panel, Tabs, Badge, AgentStatusDot, Tooltip, Dialog, Sheet, Toast, Table, Spinner, Skeleton, EmptyState, ErrorState, TerminalFrame, DiffView, CodeBlock, ThemeProvider). WCAG-AA contrast enforced in CI via `tokens.test.ts`.
- **`apps/showcase`** — buildable Vite page rendering all tokens + primitives + empty/loading/error states at desktop and phone widths.

## [0.1.0] - 2026-06-14

Phase 0 — Recon & Architecture. Skeleton compiles; CI green on Windows + macOS + Linux.

### Added
- Build workspace, cross-platform git config (`core.longpaths`, `core.autocrlf input`), `.gitattributes` EOL normalization.
- Blackboard: `STATE.json`, `DECISIONS.md` (ADR-0001..0009), `RUBRIC.md` (§6), `PARITY.md` (§5), `evidence/`.
- Preflight toolchain self-heal: installed `bun`, `pnpm` (npm), `ripgrep`, `caddy` (scoop). Recorded gaps (no Docker daemon, no `psql`) → ADR-0003 PGlite substitution.
- Phase 0 recon: `docs/recon.md` (original Superset mechanisms, shortcuts incl. Windows column, `.superset/config.json` schema) and `docs/architecture.md` (headless host engine + thin clients; monorepo topology; tRPC + Drizzle contracts; WS event-log sync; P01–P14 → package/phase map).
- Project tracking in Linear: "SWARM — Superset Replica" with 7 phase milestones + 14 parity issues (P01–P14).
- Monorepo skeleton (Bun workspaces + Turborepo): 11 `@swarm/*` packages (`shared`, `db`, `core-engine`, `agent-adapters`, `git-worktree`, `pty-supervisor`, `config`, `sync`, `api`, `terminal`, `ui`) and 5 apps (`host`, `cli`, `desktop`, `mobile`, `docs`), each with real typed contracts and a genuine inter-package type graph. Biome + strict `tsc` + `bun test`.
- CI: `.github/workflows/ci.yml` matrix over `windows-latest` + `macos-latest` + `ubuntu-latest` (install → lint → typecheck → build → test). Green: run 27519073829.

[Unreleased]: https://github.com/GhostlyGawd/superset-replica-build/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/GhostlyGawd/superset-replica-build/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/GhostlyGawd/superset-replica-build/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GhostlyGawd/superset-replica-build/releases/tag/v0.1.0
