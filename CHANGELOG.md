# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Host engine — PTY supervisor (Phase 2 wave 1).** `packages/pty-supervisor`: real `PtySupervisor` (spawn/write/onData/resize/kill, per-session PID tracking + tree-kill) over `@homebridge/node-pty-prebuilt-multiarch`, with a real-PTY integration test (spawns PowerShell + cmd, asserts streamed output and clean process-tree termination). CI gains `setup-node`.
- Completed `@swarm/api` tRPC surface to all 13 routers of architecture §3.1 (sessions, presets, ports, notifications, settings, host, auth + completed config/diffs/workspaces/agents/terminal).
- `SwarmConfig` (`packages/config`) reshaped to ordered `Command[]` for setup/teardown/run with per-OS shell support (PowerShell/cmd/bash/sh/zsh/wsl) + per-field before/after overlay + zero-dep validator (9 tests).

### Changed
- **ADR-0007a:** the PTY layer / host engine runs under **Node**, not Bun — Bun tears down the ConPTY `net.Socket` on Windows. Validated node-pty + the multiarch fallback on Node 24 across the OS matrix.

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

[Unreleased]: https://github.com/GhostlyGawd/superset-replica-build/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/GhostlyGawd/superset-replica-build/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/GhostlyGawd/superset-replica-build/releases/tag/v0.1.0
