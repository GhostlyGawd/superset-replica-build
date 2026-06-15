# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Build workspace, cross-platform git config (`core.longpaths`, `core.autocrlf input`), `.gitattributes` EOL normalization.
- Blackboard: `STATE.json`, `DECISIONS.md` (ADR-0001..0009), `RUBRIC.md` (§6), `PARITY.md` (§5), `evidence/`.
- Preflight toolchain self-heal: installed `bun`, `pnpm` (npm), `ripgrep`, `caddy` (scoop).
- Phase 0 recon: `docs/recon.md` (original Superset mechanisms, shortcuts incl. Windows column, `.superset/config.json` schema) and `docs/architecture.md` (headless host engine + thin clients; monorepo topology; tRPC + Drizzle contracts; WS event-log sync; P01–P14 → package/phase map).
- Project tracking in Linear: "SWARM — Superset Replica" with 7 phase milestones + 14 parity issues (P01–P14).
- Monorepo skeleton (Bun workspaces + Turborepo): 11 `@swarm/*` packages (`shared`, `db`, `core-engine`, `agent-adapters`, `git-worktree`, `pty-supervisor`, `config`, `sync`, `api`, `terminal`, `ui`) and 5 apps (`host`, `cli`, `desktop`, `mobile`, `docs`), each with real typed contracts and a genuine inter-package type graph. Biome + strict `tsc` + `bun test`.
- CI: `.github/workflows/ci.yml` matrix over `windows-latest` + `macos-latest` + `ubuntu-latest` (install → lint → typecheck → build → test).

### Changed

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/GhostlyGawd/superset-replica-build/commits/main
