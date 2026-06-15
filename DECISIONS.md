# DECISIONS.md — Architecture Decision Records (lightweight ADRs)

Append-only. Each ADR resolves an ambiguity without human input (spec §0.2).
Format: ID · date · status · context · decision · consequences.

---

## ADR-0001 — Build lives in its own repo, not a worktree of the harness
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Spec §3.2 says create an isolated worktree so the orchestrator's checkout stays clean. But the orchestrator's repo here is `recursive-harness` (a meta/harness repo), not the product. A git worktree would bind the product's history to the harness.
- **Decision:** Create the build as its **own fresh git repo** in a sibling dir `D:/GitHub Projects/superset-replica-build`. This satisfies the intent (harness checkout stays clean) without polluting either repo's history.
- **Consequences:** The product gets its own GitHub repo and history (spec §3.3 wants this anyway). The harness repo is untouched.

## ADR-0002 — Windows-first cross-platform is in scope (beyond original)
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Original Superset is macOS-only Electron. Spec §0.8 mandates native Windows 10/11 + macOS + Linux, proven by CI + Windows e2e.
- **Decision:** Engine + desktop client + mobile-control workflow all target Windows/macOS/Linux from day one. No POSIX-only assumptions. CI matrix includes `windows-latest`, `macos-latest`, `ubuntu-latest` from Phase 0.
- **Consequences:** Forces node-pty (ConPTY), tree-kill, path-API discipline, EOL normalization, Windows-shell terminal support, and Node/Bun task scripts instead of `.sh` on user paths.

## ADR-0003 — Docker unavailable → PGlite as the self-hosted Postgres
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Spec §3.6/§5 want self-hosted Postgres + sync via Docker (no paid cloud DB). Preflight: Docker is **not installed** and the daemon is not running on this Windows host. Docker Desktop install needs admin + WSL2 + reboot — not achievable non-interactively, and a heavy bootstrap dependency that fights the "stand it up without touching your PC" goal.
- **Decision:** Use **PGlite** (Apache-2.0, Postgres compiled to WASM, runs in-process in Node/Bun) as the self-hosted Postgres for local/dev and single-host deployments. Access via **Drizzle ORM** (Postgres dialect) so the exact same schema/queries also run against a real Postgres server when one is present (e.g. remote host). This is a documented OSS substitution, not a downgrade: PGlite *is* Postgres, self-hosted, zero external services, zero paid cloud.
- **Consequences:** One-command bootstrap needs no Docker. `DATABASE_URL` selects PGlite (default, `file://./.data/pg`) or a real Postgres. Migrations run on both via Drizzle Kit. Docker compose remains available as an optional deployment path (documented) but is not required.

## ADR-0004 — Runtime: Bun primary, Node 24 fallback; no `.sh` on user paths
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Spec stack guidance = Bun + Turborepo. Bun installed via npm during preflight; Node 24 also present.
- **Decision:** Bun for install/test/scripts and the engine where it helps; all task scripts authored in TypeScript (run via Bun/Node) so they work on PowerShell/cmd and POSIX shells alike. No bash-only scripts on any user-facing path (spec §1).
- **Consequences:** Bootstrap and presets are cross-platform by construction.

## ADR-0005 — Desktop shell: Electron (Tauri rejected)
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Need a cross-platform desktop client with a Windows installer. Tauri requires the Rust toolchain (absent; heavy non-interactive install). Electron is Node-based and already aligned with the stack.
- **Decision:** Electron + `electron-builder` producing an **NSIS** Windows installer plus macOS (dmg/zip) and Linux (AppImage/deb) artifacts. Code-signing optional (no paid certs); document SmartScreen/Gatekeeper implications.
- **Consequences:** Larger binaries than Tauri, but reliable cross-OS packaging with no extra toolchain.

## ADR-0006 — Mobile: PWA-first, Capacitor optional
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Spec §8 demands native-feeling mobile: installable, offline-first, push, gestures, 60fps. No paid native build pipeline allowed.
- **Decision:** Ship a **PWA** (installable, standalone display, service worker for offline, **Web Push/VAPID** for notifications). Optional OSS **Capacitor** shell deferred until PWA parity is proven; it reuses the same web build.
- **Consequences:** Zero app-store dependency, instant install via browser, fully OSS. Native shell can be layered later without rework.

## ADR-0007 — PTY + process-tree kill (cross-platform)
- **Date:** 2026-06-14 · **Status:** Accepted (with RISK flag)
- **Context:** Engine must spawn/supervise CLI agents via PTYs and kill process trees on every OS.
- **Decision:** `node-pty` (ConPTY on Windows) for PTYs; `tree-kill` (uses `taskkill /T /F` on Windows, signal-tree on POSIX) for termination.
- **RISK:** `node-pty` native prebuilds may not exist for Node 24. **Phase 2 opens with a validation gate**: confirm node-pty loads on this Windows host; if not, fall back to `@homebridge/node-pty-prebuilt-multiarch` or pin the engine to Node 22 LTS (documented).
- **Consequences:** Process supervision is correct on Windows (no SIGTERM tree semantics assumed).

## ADR-0008 — OSS-only stack & assets
- **Date:** 2026-06-14 · **Status:** Accepted
- **Decision:** Turborepo + Vite + Biome + tRPC + Hono + Drizzle + React + Tailwind. Fonts via **Fontsource**, icons via **Lucide/Phosphor** — all MIT/Apache/OSS. No paid SaaS, fonts, icons, or mandatory API keys (spec §0.7). License audit in Phase 6.
- **Consequences:** Everything self-hostable; license-audit clean is achievable.

## ADR-0009 — Tunnel / reverse proxy (deferred to Phase 5)
- **Date:** 2026-06-14 · **Status:** Accepted
- **Decision:** Phone-only remote path uses `cloudflared` (free) or `localtunnel` (OSS) for the tunnel and **Caddy** for TLS/reverse-proxy. Implemented in Phase 5.
- **Consequences:** No paid tunneling service required.
