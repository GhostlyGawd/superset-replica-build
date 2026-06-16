# Grove

**Mission control for a swarm of coding agents — calm surface, swarming depth.**

Grove orchestrates many CLI coding agents in parallel, each pinned to its own isolated git
worktree, with a built-in terminal, a diff viewer/inline-editor, and real-time multi-agent
monitoring — from the desktop **or your phone**. It runs natively on **Windows, macOS, and
Linux**, is fully self-hosted, and is built entirely on open-source software: no paid SaaS, no
hosted relay, no mandatory API keys, nothing phones home.

Grove runs natively on a **Windows-first, zero-Docker, OSS, self-hosted** stack: parallel CLI
agents in isolated worktrees, a terminal, diff/edit, presets, monitoring, and client/host sync,
with no paid SaaS and nothing that phones home. The name fits the model: a git worktree is
literally a *tree*; many worktrees branch off one repository and share a single `.git` object
store — one root system, many trees, a grove. Grove is where a swarm of agents works that grove,
and you watch the whole stand from one console.

The 14 parity items (P01–P14) are each verified by evidence and a green Windows + macOS + Linux
CI run — see [`PARITY.md`](./PARITY.md). Architecture decisions are recorded as ADRs in
[`DECISIONS.md`](./DECISIONS.md).

---

## What it does

- **Parallel CLI-agent orchestration over isolated git worktrees.** Run many coding agents at
  once on one host; every task gets its own branch and working directory, so agents never
  interfere with each other or with your checkout. (P01, P02)
- **Agent adapters for the tools you already use.** Claude Code, OpenAI Codex CLI, Cursor Agent,
  Gemini CLI, plus a zero-config **generic** adapter that runs *any* CLI agent. A missing CLI is
  reported honestly, never faked. (P03)
- **Live monitoring and notifications.** Per-agent status (idle / running / needs-attention /
  error / done) streamed in real time; you are alerted when a workspace needs you or has changes
  ready. (P04)
- **A built-in terminal.** xterm-based, streaming a real host PTY: tabs, split right/down, clear,
  find, preset slots (Ctrl+1–9), and prev/next tab — hosting Windows shells (PowerShell / cmd /
  Git Bash / WSL) and Unix shells alike. (P05)
- **A diff viewer with an inline editor.** Inspect each agent's changes and edit them in place;
  edits save straight back to the worktree, without leaving the app. (P06)
- **Workspace presets.** Per-project setup/teardown commands run before and after an agent
  session, with per-OS shell support. (P07)
- **Open-in-external.** One click hands a worktree off to your editor, terminal, or file manager
  — opened **on the host** where the worktree physically lives, so it works for both a local and
  a remote host. (P08)
- **Workspace navigation + customizable shortcuts.** Switch / prev / next, new and quick-create,
  open a project; every keyboard shortcut is rebindable and persisted. (P09)
- **Client/host architecture with real-time sync.** A headless host engine owns all stateful,
  OS-touching work; thin clients reach it over tRPC + an append-only event-log WebSocket. (P10)
- **Private by default.** The host binds to `127.0.0.1`, every API/WS call is gated by a 256-bit
  bearer token, and there is no telemetry. LAN exposure is an explicit opt-in. (P11)
- **A desktop app.** An Electron operator cockpit with installers for all three platforms (NSIS /
  dmg / AppImage+deb). (P05/P06/P08/P09, P14)
- **An installable mobile PWA with phone-only remote control.** Pair by scanning a QR code; the
  full agent-orchestration workflow — pairing, live read journeys, a touch terminal with a
  control-key accessory bar, real-agent dispatch, offline app-shell, and Web Push — runs from the
  phone. (P12)
- **One-command bootstrap.** `grove up` does a dependency preflight, starts the host daemon
  detached, and prints a pairing QR. `grove up --remote` opens a secure HTTPS tunnel so you can
  pair and control Grove from anywhere — without touching the PC. (P13)
- **Native Windows / macOS / Linux.** Engine, desktop, and the full workflow run on all three —
  not WSL-only — proven by a green 3-OS CI matrix and packaged-app evidence. (P14)

## Architecture

A **headless host engine** with **thin clients**:

- **Host engine** (`apps/host`) — a headless daemon that owns git/worktree operations, spawns and
  supervises CLI agents over PTYs, streams terminal / diff / status, and exposes a secure tRPC API
  plus a real-time sync channel. It runs standalone as a daemon and is also embedded in the
  desktop app's main process.
- **Desktop client** (`apps/desktop`) — Electron + React on the `@swarm/ui` design system: a
  dark-first cockpit with the terminal, diff viewer, presets, navigation, and shortcuts.
- **Mobile client** (`apps/mobile`) — an installable, offline-first PWA on `@swarm/ui` with full
  agent-orchestration control from the phone.
- **CLI** (`apps/cli`) — the `grove` command: `up`, `start` / `stop` / `status`, `host`, `pair`.
- **Data + sync** — **PGlite** (embedded Postgres compiled to WASM) via **Drizzle ORM** as the
  single source of truth, plus an own append-only **event log with resume tokens over WebSocket**.
  The same schema runs against a real Postgres server when one is present.

See [`docs/getting-started.md`](./docs/getting-started.md) to stand it up, and
[`docs/demo.md`](./docs/demo.md) for an end-to-end walkthrough.

## Stack

Open-source only (ADR-0008): no paid SaaS, fonts, icons, or mandatory API keys.

| Layer | Choice |
| --- | --- |
| Runtime / toolchain | **Bun** (primary), **Node 24** (the engine + PTY layer run under Node — ADR-0007a) |
| Monorepo | **Turborepo** |
| Build / bundling | **Vite** (clients), `bun build` (engine + CLI) |
| Lint / format | **Biome** |
| API | **tRPC** over **Hono** |
| Data | **PGlite** (embedded Postgres) via **Drizzle ORM** |
| UI | **React** + **Tailwind** on the `@swarm/ui` design system |
| Desktop | **Electron** (+ `electron-builder`: NSIS / dmg / AppImage+deb) |
| Mobile | **PWA** (installable, service worker, Web Push / VAPID) |
| Type | IBM Plex Sans / Mono via **Fontsource** (SIL OFL); icons via **Lucide** |

**No Docker (ADR-0003).** The original's self-hosted Postgres + sync ran on Docker. Docker can't
be assumed on every target (Docker Desktop needs admin + WSL2 + a reboot, which fights the
"stand it up without touching your PC" goal), so Grove uses **PGlite** — Postgres compiled to
WASM, running in-process — as the self-hosted database. PGlite *is* Postgres: self-hosted, zero
external services, zero paid cloud. Because access is through Drizzle, the exact same schema and
queries also run against a real Postgres server when one is present. A Docker compose path remains
available as an optional deployment, but nothing requires it.

## Quickstart

Prerequisites: **Node 24**, **Bun**, and **Git** (`cloudflared` only for the remote path).

```sh
bun install
(cd apps/cli && bun link)   # puts a real `grove` command on your PATH
grove up
```

`grove` is the `@swarm/cli` workspace executable; `bun link` exposes it globally (or run it from
the repo directly with `node apps/cli/src/index.ts <verb>` — see
[`docs/getting-started.md`](./docs/getting-started.md)).

`grove up` runs a cross-platform dependency preflight, starts the host daemon in the background
(creating the PGlite store, the bearer token, and a VAPID keypair on first boot), and prints a
pairing **QR**. Scan it with your phone's camera to pair, or pair the desktop app — then open a
real git project, cut worktrees, and dispatch agents.

To control Grove from anywhere (phone-only remote, no LAN setup):

```sh
grove up --remote
```

This opens a `cloudflared` quick-tunnel (HTTPS), pairs over the public URL, and — because that
origin is a secure context — lights up on-device service-worker install and Web Push. The bearer
token never travels in the QR.

Full setup, the phone-only remote path, and every core workflow are in
[`docs/getting-started.md`](./docs/getting-started.md).

## Documentation

- [`docs/getting-started.md`](./docs/getting-started.md) — zero-to-running, cross-platform,
  including the phone-only remote path.
- [`docs/demo.md`](./docs/demo.md) — a guided end-to-end walkthrough exercising every parity item
  plus the desktop, mobile, and remote paths.
- [`docs/design-system.md`](./docs/design-system.md) — the Grove visual + interaction system.
- [`DECISIONS.md`](./DECISIONS.md) — architecture decision records (ADRs).
- [`PARITY.md`](./PARITY.md) — the 14-item feature-parity checklist with evidence.

## Cross-platform support

Grove targets **Windows 10/11, macOS, and Linux** natively — engine, desktop client, and the full
agent-orchestration workflow, not WSL-only. This is proven, not asserted: every release is gated on
a green **`windows-latest` + `macos-latest` + `ubuntu-latest`** CI matrix (build, lint, typecheck,
unit/integration/e2e on all three), with a packaged-app build validated cold on each OS. A red or
skipped OS job is treated as not done (RUBRIC §6.1).

## License

Grove is licensed under the **MIT License** — see [`LICENSE`](./LICENSE). It is built on an
OSS-only dependency tree (ADR-0008) — Apache-2.0, MIT, BSD, ISC, and SIL OFL components — with no
paid SaaS and no mandatory API keys. The whole-product license audit is part of the launch
sign-off ([`evidence/phase-6/license-audit.md`](./evidence/phase-6/license-audit.md)).
