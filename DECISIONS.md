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

## ADR-0007a — PTY validation gate outcome: package + runtime pinned
- **Date:** 2026-06-14 · **Status:** Accepted (resolves the ADR-0007 RISK flag)
- **Context:** Phase 2 opened with the ADR-0007 load-validation gate (Windows, Node 24). Findings: (1) official `node-pty@1.1.0` is N-API and its **bundled** win/mac prebuilds load cleanly on Node 24 — the feared "no Node-24 prebuild" does **not** occur — but it ships **no Linux prebuild** (compiles via node-gyp). (2) **Decisive blocker not in ADR-0007:** node-pty **cannot run under Bun on Windows** — its ConPTY data pipe rides a `net.Socket` that Bun tears down (`ERR_SOCKET_CLOSED`); reproduced identically on every node-pty fork. See `evidence/phase-2/pty-validation.md`.
- **Decision:** Use **`@homebridge/node-pty-prebuilt-multiarch`** (ships prebuilds for win32-x64 + darwin + linux-x64/musl incl. the Node 24 ABI → no compiler on any CI runner) with **`tree-kill`**. Run the `pty-supervisor` **under Node 24, never Bun** (it already lives in a crashable child process per architecture §1/§5). Add the package to Bun **`trustedDependencies`** so win/mac prebuilds download at install (Linux is offline-bundled); add `actions/setup-node@v4` (node 24) to CI so the PTY integration test drives shells through Node.
- **Consequences:** PTYs spawn/stream/resize/tree-kill correctly on Windows/macOS/Linux with no build toolchain in CI. Monorepo stays on Bun for install/build/most tests; only the PTY-touching process is pinned to Node. Watch items: `prebuild-install` is deprecated upstream (still functional; matrix actively maintained), and win/mac prebuilds are a network download at install. Re-evaluate official `node-pty` if/when it bundles a Linux prebuild.

## ADR-0008 — OSS-only stack & assets
- **Date:** 2026-06-14 · **Status:** Accepted
- **Decision:** Turborepo + Vite + Biome + tRPC + Hono + Drizzle + React + Tailwind. Fonts via **Fontsource**, icons via **Lucide/Phosphor** — all MIT/Apache/OSS. No paid SaaS, fonts, icons, or mandatory API keys (spec §0.7). License audit in Phase 6.
- **Consequences:** Everything self-hostable; license-audit clean is achievable.

## ADR-0009 — Tunnel / reverse proxy (deferred to Phase 5)
- **Date:** 2026-06-14 · **Status:** Accepted
- **Decision:** Phone-only remote path uses `cloudflared` (free) or `localtunnel` (OSS) for the tunnel and **Caddy** for TLS/reverse-proxy. Implemented in Phase 5.
- **Consequences:** No paid tunneling service required.

## ADR-0010 — Product name: Grove (codename SWARM retired)
- **Date:** 2026-06-14 · **Status:** Accepted
- **Context:** Phase 1 must choose the final, shippable product name (spec §6.3 / brief). It has to be original, ownable, easy as a CLI verb, and must not evoke "Superset." The codename **SWARM** is on-message but weakly ownable — it collides with Docker Swarm and Foursquare Swarm and is a generic noun.
- **Decision:** Ship as **Grove** (CLI: `grove`). A git **worktree** is literally a *tree*; many worktrees branch off one repository and share a single `.git` object store — one root system, many trees, i.e. a grove. The product is where a swarm of agents works that grove. The name is original, ownable, a clean CLI verb, does not evoke Superset, and — unlike a bolted-on label — anchors a coherent design thesis ("mission control for a swarm; calm surface, swarming depth"). "Swarm" is retained as common-noun product vocabulary, not the brand.
- **Consequences:** `STATE.json.project.final_name = "Grove"`. Brand + identity recorded in `docs/brand/` (name, story, voice, logo + hand-authored SVG mark/wordmark); the full visual system in `docs/design-system.md`; implementation in `packages/ui` (`@swarm/ui` v0.2.0) with the `apps/showcase` proof. The `superset-replica` repo name and Linear project keep their identifiers; only the user-facing product name changes.
