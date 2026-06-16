# Getting started

Stand up Grove and run a swarm of coding agents in parallel — on **Windows, macOS, or Linux**,
from your desktop and your phone. This guide goes from zero to a running host, a paired desktop
app, a paired phone (including the **phone-only remote** path), and through every core workflow.

Grove is **private by default**: the host binds to `127.0.0.1`, every API and WebSocket call is
gated by a 256-bit bearer token, and nothing is exposed to the network or the internet unless you
opt in.

---

## Prerequisites

| Tool | Required | Notes |
| --- | --- | --- |
| **Node.js 24** | yes | The host engine and PTY layer run under Node (ADR-0007a). Node ≥ 22 is the floor; 24 is recommended. |
| **Bun** | yes | Install, build, and most scripts run on Bun. |
| **Git** | yes | Grove operates on real git repositories and worktrees. |
| **cloudflared** | optional | Only for the phone-only remote path (`grove up --remote`). `localtunnel` is the OSS fallback. |

`grove up` runs this exact check for you and prints a ✓/✗ table with copy-pasteable install
hints; a missing required tool aborts the bootstrap before anything starts.

## Install

Clone the repository and install dependencies:

```sh
git clone https://github.com/GhostlyGawd/superset-replica-build.git grove
cd grove
bun install
```

### Running the `grove` command

`grove` is a real executable — it is the `bin` of the `@swarm/cli` workspace package (entry
`apps/cli/src/index.ts`, run under Node). Every command in this guide is written as `grove <verb>`.

The simplest way to get a global `grove` on your `PATH` is to link the package once from the repo:

```sh
cd apps/cli
bun link            # registers a global `grove` command
cd ../..
grove help          # now available anywhere
```

`bun link` installs a launcher (`grove` / `grove.exe` on Windows) into Bun's global bin directory
(`~/.bun/bin`, which Bun adds to your `PATH`); `bun unlink` from `apps/cli` removes it again.

Prefer not to link globally? Run the same executable straight from the repository — no link, no
build:

```sh
node apps/cli/src/index.ts <verb> [options]    # the executable, run directly
# or, equivalently:
bun apps/cli/src/index.ts <verb> [options]
```

Run `grove help` (or `grove --help`) at any time for the full command + flag list.

---

## `grove up` — one command to stand it up

```sh
grove up
```

`grove up` is the friendly bootstrap. In one command it:

1. **Dependency preflight** — checks Node / Bun / Git (and notes whether `cloudflared` is
   present) cross-platform, with no shell assumptions. A missing required tool prints exact
   install guidance and exits without half-starting.
2. **Starts the host daemon, detached** — the daemon runs in the background under Node and writes
   a manifest (endpoint + bearer token + PID) to `~/.grove/host/manifest.json`. On first boot the
   host creates the **PGlite** data store, the **bearer token**, and a **VAPID** keypair (for Web
   Push). Re-running `grove up` is idempotent: it attaches to and reports a daemon that is already
   running, never double-starts one.
3. **Prints a pairing QR** — a single-use, short-lived code rendered as a scannable terminal QR
   plus text. The bearer token is **never** in the QR (only the code is).

A typical summary:

```
Grove is up.
  endpoint:  http://127.0.0.1:53124
  pid:       48217
  scan the QR above with your phone's camera to pair.
  run 'grove stop' to shut it down.
```

Useful flags:

| Flag | Effect |
| --- | --- |
| `--check` | Run the dependency preflight only; start nothing. |
| `--port <n>` | Bind a specific TCP port (`0` = OS-assigned, the default). |
| `--db <dir>` | Use a specific PGlite data directory. |
| `--host <addr>` | Bind address (default `127.0.0.1`). |
| `--lan` | Bind `0.0.0.0` and show a LAN URL — pair a phone on the same network (see below). |
| `--remote` | Pair over a public HTTPS quick-tunnel — pair a phone from anywhere (see below). |
| `--provider <name>` | Tunnel provider for `--remote`: `cloudflared` (default) or `localtunnel`. |

### Lifecycle: `start` / `stop` / `status`

`grove up` composes these primitives; you can also use them directly.

```sh
grove start     # start the host daemon detached (same flags as up: --port/--db/--host/--lan)
grove status    # report real liveness: RUNNING (with uptime) / UNHEALTHY / STOPPED
grove stop      # stop the daemon: graceful, then a forced process-tree kill if it survives
```

`grove status` is honest about every state — no manifest, a stale manifest (dead PID), or a
process that is up but whose endpoint isn't answering — and prints uptime when healthy. `grove
stop` tree-kills the daemon's whole process group (`taskkill /T` on Windows, a POSIX group signal
elsewhere) and clears the manifest.

> `grove host` runs the daemon in the **foreground** (for debugging). For normal use prefer
> `grove up` / `grove start`, which run it detached.

---

## Pair the desktop app

The desktop app is an Electron cockpit (`apps/desktop`). It connects to the **real** host the
daemon you just started exposes.

- Install it from a packaged build (`apps/desktop`, via `electron-builder` — NSIS on Windows,
  dmg on macOS, AppImage/deb on Linux), or run the renderer in development with
  `bun run --filter @swarm/desktop dev`.
- The desktop app reads the host endpoint + bearer from `~/.grove/host/manifest.json` (the
  daemon and the app share this file), so once `grove up`/`grove start` is running it connects
  automatically. For development against a non-default host you can set `GROVE_HOST_URL` /
  `GROVE_HOST_TOKEN`.

> Unsigned by design: there are no paid code-signing certificates, so Windows SmartScreen /
> macOS Gatekeeper will show an unknown-publisher prompt on first launch ("More info → Run
> anyway"). This is the expected OSS-only behavior, documented in `apps/desktop/PACKAGING.md`.

## Pair a phone

The host **serves the PWA** at its own origin, so the phone talks to the same endpoint over the
same bearer model — no separate app store, no separate server.

```sh
grove pair
```

This mints a single-use code on the running host and prints a scannable QR encoding the host URL
plus `?code=<CODE>`. On the phone:

1. Scan the QR (or open the printed URL).
2. The PWA reads the `?code=` and redeems it; the host hands back the bearer in the response body.
3. The bearer is stored in the phone's **IndexedDB** (never in the QR, the URL, or the service-
   worker cache), and the phone goes live over tRPC + the sync WebSocket.

Pairing codes are single-use, short-lived (2-minute TTL), constant-time compared, and rate-limited
(a 5-strike lockout) — and they live only in memory, so restarting the host invalidates every
outstanding code.

### Same-network pairing (`--lan`)

If your phone is on the same network and you don't need internet access, opt in to a LAN bind:

```sh
grove up --lan      # (or: grove start --lan, then grove pair --lan)
```

`--lan` binds the host to `0.0.0.0` and rewrites the pairing URL to the host's LAN IP so the phone
can reach it. LAN exposure is always an explicit opt-in — the default stays loopback-only (P11).
On a plain-HTTP LAN origin the responsive client, pairing, and live tRPC/sync all work; the
service worker and Web Push light up only on a secure (HTTPS) origin — which the remote path
below provides.

### Phone-only remote (`--remote`) — control Grove from anywhere

The remote path lets you pair and drive Grove **from your phone, anywhere, without touching the
PC** — and it is where on-device install + push fully light up.

```sh
grove up --remote          # bootstrap + open a tunnel + pair over HTTPS, in one command
# or, against an already-running host:
grove pair --remote
```

What happens:

1. The daemon is ensured running (idempotent).
2. A **`cloudflared` quick-tunnel** opens (`cloudflared tunnel --url http://127.0.0.1:<port>`),
   giving the loopback host a public, **HTTPS** origin with a publicly-trusted edge certificate
   and no account. If `cloudflared` isn't installed, Grove falls back to **`localtunnel`** (the
   fully-OSS option); pin a provider with `--provider cloudflared|localtunnel`.
3. Pairing points at the tunnel URL; the QR encodes `<tunnelUrl>/?code=<CODE>` — again, the bearer
   never rides the QR.
4. Scan from the phone. Because the tunnel origin is HTTPS (a secure context), the **service
   worker installs** and **Web Push** turns on, on top of the full live workflow.

The host itself never leaves `127.0.0.1`; the tunnel terminates TLS at the provider edge and
proxies to loopback. The tunnel stays up until you press **Ctrl-C** (or run `grove stop`); the
daemon keeps running after the tunnel closes.

> Installing the PWA: in the phone browser's menu choose **Add to Home Screen** / **Install**. On
> iOS, Web Push fires only for an **installed** PWA on iOS 16.4+ and the opt-in must be triggered
> by a tap.

---

## Core workflows

Once a client is paired, the day-to-day loop is: open a project → cut worktrees → dispatch agents
→ monitor → review and edit diffs → use the terminal → hand off externally.

### 1. Open a project

Point Grove at a **real git repository** on the host. Grove validates it (`git rev-parse`)
— it must be an actual git working tree — registers it as a project, and seeds a first isolated
worktree from its current branch. (The project path is entered as text; a native folder picker is
a desktop nicety, but text entry is portable and works everywhere.)

### 2. Cut worktrees

Create additional worktrees with **New** or **Quick-create**. Each worktree is a fresh branch and
working directory branching off the project's shared `.git` store — this is the isolation that
lets agents run in parallel without colliding. (P02)

### 3. Dispatch agents

Start an agent on a worktree and pick an adapter:

| Adapter | CLI it runs |
| --- | --- |
| **Claude Code** | `claude` |
| **OpenAI Codex CLI** | `codex` |
| **Cursor Agent** | `cursor-agent` |
| **Gemini CLI** | `gemini` |
| **Generic CLI** | any terminal command you provide (zero-config) |

Grove detects whether a named CLI is on `PATH`; if it isn't, it tells you honestly (and you can
set a custom command in **Settings → Agents**) — it never fakes a run. The **generic** adapter
runs whatever command you give it, so any CLI agent works out of the box. Dispatch many at once —
that is the point. (P01, P03)

### 4. Monitor

Every agent reports a live status — **idle**, **running**, **needs-attention** (it's waiting on
you), **error**, or **done** — streamed over the sync WebSocket and surfaced in the workspace
rail, an Agents roll-up, and the status bar. Status is triple-encoded (color + label + shape), so
it's legible at a glance and accessible. You're notified when a workspace needs attention or has
changes ready; on a paired phone with push enabled, that arrives as a Web Push notification. (P04)

### 5. Review diffs + inline edit

Open a worktree's diff to inspect exactly what an agent changed — real `git diff`, gutter-aligned
hunks, add/remove tints. On the desktop you can **edit inline** and save straight back to the
worktree; you can also discard a file's changes. The phone offers read-only diff review. (P06)

### 6. Built-in terminal

The terminal streams a **real PTY on the host** over a bearer-gated WebSocket:

- **Tabs**, **split right** / **split down**, **clear**, and **find**.
- **Preset slots** on `Ctrl+1`–`Ctrl+9` and prev/next-tab navigation.
- Hosts **Windows shells** (PowerShell / cmd / Git Bash / WSL) and Unix shells; your workspace
  preset commands run on the right shell per OS. (P05, P07)

On the phone the terminal is a single pane with a **touch accessory bar** that synthesizes the
exact control bytes a hardware keyboard sends — a sticky **Ctrl** modifier (so the next key is
Ctrl-chorded, e.g. Ctrl-C), **Esc** / **Tab** / arrows / **Enter**, and the CLI punctuation a
phone keyboard buries (`| ~ / \ - _ $ * & > ...`).

### 7. Open-in-external

Hand a worktree off with one click to your **editor** (`$VISUAL`/`$EDITOR`, else `code`/`cursor`),
your **terminal** (Windows Terminal / cmd, macOS Terminal.app, Linux `$TERMINAL` /
`x-terminal-emulator`), or your **file manager** (`explorer` / `open` / `xdg-open`). The launch
happens **on the host**, where the worktree physically lives — so it's correct for a local host
and a remote one alike. (P08)

### 8. Keyboard shortcuts + settings

Navigation and actions are keyboard-first. Defaults include prev/next worktree
(`Ctrl+Alt+↑`/`Ctrl+Alt+↓`), quick-create (`Ctrl+Alt+N`), open project (`Ctrl+Alt+O`), and
settings (`Ctrl+,`). **Every shortcut is rebindable** from the Settings surface — capture a new
keystroke, or reset to default — and overrides are **persisted in PGlite**, so they survive a
restart. Settings is also where you tune agent adapters and toggle the theme (dark-first, with a
light theme). (P09)

---

## Private by default — a note on exposure

- The host binds to **`127.0.0.1`** unless you pass `--lan` or `--host`.
- Every `/trpc` and WebSocket call requires the **bearer token**; unauthenticated calls are
  rejected (401). The token lives in the host manifest (desktop) or the phone's IndexedDB (PWA),
  never in a QR or URL.
- There is **no telemetry**; nothing phones home.
- `--lan` and `--remote` are deliberate, explicit opt-ins — and even then the bearer, not the
  origin, is the gate. (P11)

## Troubleshooting

- **`grove up` aborts on a missing tool** — install the tool from the printed hint and re-run.
  Use `grove up --check` to verify prerequisites without starting anything.
- **`grove status` says UNHEALTHY** — the process is alive but the endpoint isn't answering; run
  `grove stop` then `grove up` to restart cleanly. The daemon log is at `~/.grove/host/daemon.log`.
- **`--remote` says no tunnel provider found** — install `cloudflared` (recommended) or
  `npm i -g localtunnel`, then re-run with `--remote`.
- **Phone can pair but can't install / enable push** — the service worker and Web Push need a
  secure (HTTPS) origin. Use `grove up --remote` (HTTPS tunnel); a plain-HTTP LAN origin won't
  enable them.

## Where to go next

- [`docs/demo.md`](./demo.md) — a full guided walkthrough that exercises every parity item plus
  the desktop, mobile, and remote paths.
- [`PARITY.md`](../PARITY.md) — the parity checklist with evidence links.
- [`DECISIONS.md`](../DECISIONS.md) — the architecture decision records behind these choices.
