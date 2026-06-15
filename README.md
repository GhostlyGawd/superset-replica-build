# SWARM (codename) — orchestrate swarms of CLI coding agents in parallel

> A 1:1, fully-working, cross-platform replica of [Superset](https://github.com/superset-sh/superset):
> the code editor for the AI-agents era. Spawn many CLI coding agents in parallel, each isolated in
> its own git worktree; watch them live, review diffs, and merge — from desktop **or your phone**.
> Runs natively on **Windows, macOS, and Linux**. 100% OSS, self-hostable, no paid dependencies.

**Status:** Phase 0 (Recon & Architecture). This README is filled out as the build progresses; see
`docs/architecture.md` for the design, `PARITY.md` for the feature checklist, and `DECISIONS.md` for ADRs.

## Architecture (headless host engine + thin clients)
- **Host engine** — headless daemon: owns git/worktree ops, spawns & supervises CLI agents over PTYs,
  streams terminal/diff/status, exposes a secure tRPC API + real-time sync.
- **Desktop client** — Electron; full parity with the original (terminal, diff viewer, presets, shortcuts).
- **Mobile client** — installable PWA; full agent-orchestration control from the phone.
- **DB/sync** — PGlite (embedded Postgres) via Drizzle; self-hosted WebSocket sync (no paid cloud).

See `docs/` for setup (including the phone-only remote path) once Phase 5 lands.
