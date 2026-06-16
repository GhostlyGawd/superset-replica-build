# Grove — guided demo

A scripted, end-to-end walkthrough you can follow to exercise **all 14 parity items (P01–P14)**
plus the **desktop**, **mobile**, and **phone-only remote** paths. It is written to prove the
product works: each step says what to do and what you should see.

Allow ~25–35 minutes. You'll stand up a host, pair the desktop and a phone, open a real repo, run
several agents in parallel, watch them live, review and edit a diff, drive the terminal, hand a
worktree off externally, and finally control the whole thing from your phone over a secure tunnel.

> Commands are written as `grove <verb>`. See [getting-started.md](./getting-started.md#running-the-grove-command)
> for how to invoke the CLI from the repo (or to alias `grove`).

---

## 0. Prepare

You'll need a **real git repository** to drive agents against. Any local repo works; for a clean
demo, make a throwaway one:

```sh
mkdir grove-demo-repo && cd grove-demo-repo
git init && git commit --allow-empty -m "init"
cd -
```

Prerequisites: Node 24, Bun, Git. For the remote section (step 9), also install `cloudflared`
(or `localtunnel`). Confirm everything is present without starting anything:

```sh
grove up --check
```

**Expect:** a ✓/✗ table — Node.js, Bun, Git all ✓; cloudflared shown as ✓ or `–` (optional).
The command reports "all required tools present" and starts nothing. _(P13 — preflight)_

---

## 1. Bootstrap the host — P13

```sh
grove up
```

**Expect:**

- The dependency table, then a scannable **QR** in the terminal.
- A summary with `endpoint: http://127.0.0.1:<port>`, a `pid`, and "scan the QR ... to pair".

Behind that one command: the daemon started **detached**, and on first boot the host created the
**PGlite** store, the **bearer token**, and a **VAPID** keypair. Confirm liveness and idempotency:

```sh
grove status      # → RUNNING  endpoint=...  pid=...  uptime=...
grove up          # run it again → reports the SAME daemon, does not double-start
```

**Expect:** `grove status` prints `RUNNING` with uptime; the second `grove up` attaches to the
already-running daemon. _(P13 — one-command bootstrap + lifecycle)_

> Keep this terminal's host running for the whole demo. Open new terminals for other commands.

---

## 2. Verify private-by-default — P11

```sh
curl -i http://127.0.0.1:<port>/trpc/workspaces.list
```

**Expect:** **HTTP 401** — the API rejects an unauthenticated call. Now the liveness probe, which
is intentionally open:

```sh
curl -s http://127.0.0.1:<port>/healthz      # → {"ok":true}
```

**Expect:** `/healthz` answers `{"ok":true}`, but every `/trpc` and WebSocket call needs the
bearer token. The host is bound to `127.0.0.1`; nothing is on the network. _(P11 — private by
default)_

---

## 3. Pair the desktop app — P05/P06/P08/P09/P14 surface

Launch the desktop cockpit — either a packaged build (`apps/desktop`, installed via the
`electron-builder` NSIS/dmg/AppImage artifact) or, in development:

```sh
bun run --filter @swarm/desktop dev
```

**Expect:** a dark-first operator console — a workspace rail, a content pane, and a status bar —
that connects to the running host automatically (it reads endpoint + bearer from
`~/.grove/host/manifest.json`). You should see a live connection (host status, an empty or seeded
workspace list). This is the surface you'll use for P05/P06/P08/P09; the packaged app itself is
part of P14.

---

## 4. Open a project and cut worktrees — P02

In the desktop app, **open a project** and give it the path to your `grove-demo-repo` (or any real
repo).

**Expect:** Grove validates it's a real git working tree, registers it, and seeds a first
worktree. Now create two or three more with **Quick-create** (or `Ctrl+Alt+N`).

**Expect:** several workspaces in the rail, each its own branch + working directory off the shared
`.git` store. Confirm on disk if you like — each worktree is a separate directory on a distinct
branch. _(P02 — worktree isolation)_

---

## 5. Dispatch several agents in parallel — P01/P03/P07

Dispatch an agent onto each worktree. For each, pick an adapter:

- If you have a real agent CLI installed, choose **Claude Code** (`claude`), **OpenAI Codex CLI**
  (`codex`), **Cursor Agent** (`cursor-agent`), or **Gemini CLI** (`gemini`).
- Otherwise choose **Generic CLI** and give it any terminal command — e.g. a short shell command
  that touches a file and exits. The generic adapter runs *any* CLI agent, zero-config.

**Expect:**

- If a named CLI is **not** installed, Grove says so honestly (and points you to Settings →
  Agents) — it never fakes a run. _(P03)_
- Multiple agents run **at the same time** across the isolated worktrees, none blocking another —
  this is the core capability. _(P01 — parallel execution)_
- If the project has a `.grove/config.json`, its **setup** commands run before the agent starts
  and **teardown** after the session ends, on the correct per-OS shell. _(P07 — presets)_

---

## 6. Monitor the swarm live — P04/P10

Watch the rail and the Agents roll-up as the agents work.

**Expect:**

- Each agent's status moves through **running** → **needs-attention** (if it pauses for input) →
  **done** (or **error**), updating in **real time** without a refresh. Status is shown as color +
  label + shape together.
- When a worktree needs attention or has changes ready, you get a notification. _(P04 — monitoring
  & notifications)_

The live updates arrive over the host's append-only **event-log WebSocket** — the same client/host
sync channel the desktop and phone both consume. _(P10 — client/host real-time sync)_

---

## 7. Review and edit a diff — P06

Pick a worktree whose agent changed files and open its **diff**.

**Expect:** the real `git diff` — changed-file list, gutter-aligned hunks, green/red add/remove
tints. On the desktop, **edit a line inline and save**; reopen the diff and confirm your edit
landed in the worktree. Try **discard** on a file to revert its changes.

**Expect:** inline edits write straight back to the worktree, and discard reverts — all without
leaving the app. _(P06 — diff viewer + inline editor)_

---

## 8. Drive the built-in terminal — P05/P14

Open the **terminal** for a worktree.

**Expect:** a live shell streaming a **real host PTY**. Exercise:

- **Tabs** — open a second tab; switch with prev/next.
- **Split** right and down.
- **Find** in the buffer; **clear** it.
- A **preset slot** on `Ctrl+1`–`Ctrl+9`.
- On Windows, confirm it hosts **PowerShell / cmd / Git Bash / WSL**; on macOS/Linux, your Unix
  shells. Run a command and see output stream back; the agent process tree is killed correctly
  when you stop it. _(P05 — built-in terminal; P14 — native Windows/macOS/Linux shells)_

---

## 9. Pair a phone and control Grove remotely — P12/P13

This is the phone-native path. From a terminal on the host:

```sh
grove pair --remote
```

**Expect:**

- "Opening a cloudflared tunnel…", then a public `https://<random>.trycloudflare.com` URL.
- A **QR** encoding `<tunnelUrl>/?code=<CODE>` and a "scan from your phone, anywhere" hint. The
  bearer token is **not** in the QR.

On the phone:

1. **Scan** the QR. The installable PWA loads from the tunnel origin.
2. It reads the `?code=`, redeems it, and stores the bearer in **IndexedDB** — you're live.
3. **Install** it ("Add to Home Screen") and, in Settings, **enable notifications**.

**Expect on the phone:**

- The live **workspace list**, a workspace **detail** view (branch, ahead/behind, running agents,
  session history), and a cross-workspace **Agents** roll-up — all updating live. _(P12 — read
  journeys)_
- **Read-only diff review** of an agent's changes. _(P12)_
- A **touch terminal** over the `/terminal` WebSocket: type into the shell and use the **accessory
  bar** — arm sticky **Ctrl** then press `C` to send Ctrl-C, send **Esc** / **Tab** / arrows /
  **Enter**, and tap buried CLI symbols like `~ / -`. _(P12 — touch terminal)_
- **Dispatch a real agent** from the phone (New worktree / Start agent) and watch it appear live
  in Agents. _(P12 — real-agent dispatch)_
- Because the tunnel origin is **HTTPS** (a secure context), the **service worker** installs (the
  app works offline at the shell level) and **Web Push** turns on — trigger a `needs-attention`
  event and confirm a push notification arrives. _(P12 — offline SW + Web Push; P13 — phone-only
  remote setup)_

> Same-network alternative: `grove up --lan` then `grove pair --lan` pairs over the LAN IP. The
> live workflow works over plain HTTP, but install + push need the HTTPS origin the `--remote`
> tunnel provides.

The tunnel stays up until you press **Ctrl-C**; the daemon keeps running afterward.

---

## 10. Hand a worktree off externally — P08

Back on the desktop (or via the host), use **open-in-external** on a worktree: open it in your
**editor**, a **terminal**, or your **file manager**.

**Expect:** the target app opens the worktree directory — launched **on the host** where the
worktree physically lives (so this is identical for a local and a remote host). _(P08 —
open-in-external)_

---

## 11. Rebind a shortcut and confirm it persists — P09

Open **Settings** (`Ctrl+,`), pick a shortcut (e.g. quick-create), **capture a new keystroke**,
and save. Reload the app.

**Expect:** the new binding is still in effect after reload — overrides are persisted in PGlite.
Reset-to-default works too. _(P09 — customizable shortcuts + settings)_

---

## 12. Native cross-platform — P14

You've just run the engine, the desktop client, and the full workflow on your OS. P14 is the claim
that this holds on **Windows, macOS, and Linux** natively (not WSL-only):

- The built-in terminal hosting native Windows shells (step 8) and correct process-tree kills are
  part of it.
- The packaged desktop app (the `electron-builder` NSIS / dmg / AppImage+deb artifacts) is the
  other part — see `evidence/phase-5/installers.md` for a real 97.6 MB Windows NSIS installer and
  a packaged-app launch.
- The whole matrix is proven by a green **`windows-latest` + `macos-latest` + `ubuntu-latest`** CI
  run (build, lint, typecheck, unit/integration/e2e, plus a cold packaging build on each OS).
  _(P14 — native Windows/macOS/Linux)_

---

## 13. Tear down

```sh
grove stop      # graceful, then a forced process-tree kill if needed
grove status    # → STOPPED
```

**Expect:** the daemon stops, its process tree is gone, the manifest is cleared, and `grove
status` reports `STOPPED`.

---

## Parity coverage map

| Item | Proven in step |
| --- | --- |
| **P01** Parallel execution | 5 |
| **P02** Worktree isolation | 4 |
| **P03** Agent adapters (Claude Code / Codex / Cursor / Gemini / generic) | 5 |
| **P04** Monitoring & notifications | 6 |
| **P05** Built-in terminal (tabs/splits/find/clear/preset slots) | 8 |
| **P06** Diff viewer + inline editor | 7 |
| **P07** Workspace presets (setup/teardown) | 5 |
| **P08** Open-in-external | 10 |
| **P09** Workspace navigation + customizable shortcuts/settings | 4, 11 |
| **P10** Client/host + real-time sync | 6 |
| **P11** Private by default | 2 |
| **P12** Mobile-native control (read, touch terminal, dispatch, offline, push) | 9 |
| **P13** Self-bootstrap + phone-only remote setup | 0, 1, 9 |
| **P14** Native Windows / macOS / Linux | 8, 12 |
| Desktop path | 3–8, 10, 11 |
| Mobile path | 9 |
| Remote path | 9 |

For the authoritative status and evidence links, see [`PARITY.md`](../PARITY.md).
