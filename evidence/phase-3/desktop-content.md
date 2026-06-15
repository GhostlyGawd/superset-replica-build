# Phase 3 — Desktop Content Pane (P05 Terminal + P06 Diff)

**Date:** 2026-06-15 · **Host:** Windows 10 Home build 19045 (x64) · **Toolchain:** Node v24.14.1, Bun 1.3.14
**Result:** GATE PASSED — `bun run lint` clean, `turbo run typecheck build test --force` 43/43 green (run twice), banned-token scan clean, Playwright e2e 4/4 green against a REAL host (via node).

The desktop foundation's content-pane well now hosts the two heart-of-the-tool features, both wired to the real host engine (no fakes): a built-in xterm terminal streaming a real PTY, and a diff viewer with inline editing that saves back to the worktree.

## What was built

### 1. Terminal panel (P05) — `apps/desktop/src/renderer/terminal/`
- `XtermView.tsx` — one xterm.js session (`@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-search`). Opens a WebSocket to the host's `/terminal` topic, writes incoming `data` frames to the terminal, sends local keystrokes back as `data` frames, and fits + reports `resize` on viewport change. Default DOM renderer (no canvas/webgl addon) so streamed text is assertable; the full received stream is also mirrored into a visually-hidden `data-testid="terminal-stream"` on the focused pane.
- `TerminalPanel.tsx` — `@swarm/ui` `TerminalFrame` chrome with: tabs (+ close), **split right/down** (max 2 panes/tab), clear, find (search addon, overlay box), **preset slots Ctrl+1–9** (`presets.ts`), prev/next tab. Keymap is a capture-phase `keydown` listener using the **design-system Windows bindings** (`docs/recon.md` Windows column): new tab `Ctrl+Shift+T`, clear `Ctrl+Shift+K`, find `Ctrl+Shift+F`, split right `Ctrl+Shift+D`, split down `Ctrl+Shift+Alt+D`, prev/next tab `Ctrl+Shift+Tab`/`Ctrl+Tab`, presets `Ctrl+1..9`.

### 2. Diff viewer + inline editor (P06) — `apps/desktop/src/renderer/diff/DiffPanel.tsx`
- Fetches the selected workspace's **real git diff** (`diffs.status` → changed files; `diffs.getFileDiff` → hunks + old/new text) and renders with `@swarm/ui` `DiffView`. File list with +/- counts; real loading/empty/error states.
- **Inline edit → save-back:** an editor seeded from the on-disk text; **Save** calls `diffs.writeFile` (a real file write into the worktree), then re-fetches status + diff so the viewer reflects the new state. Also a per-file discard (`diffs.discard`).
- Wire shapes are derived from the tRPC client (`Awaited<ReturnType<…>>`) so the Node-only `@swarm/git-worktree` package is never imported into the browser bundle.

`ContentPane.tsx` now renders a tabbed **Terminal | Diff** surface (`ContentTabs.tsx`) for the selected worktree; the terminal stays mounted across tab switches so its live PTYs survive. `useHost.ts` was extended to expose the live tRPC `client` + `{endpoint, token}` `conn` (the tRPC client is a callable proxy, so it is stored via the lazy `setState(() => client)` form).

## Terminal-IO WebSocket approach (out-of-band from the sync log)
Per architecture §4, terminal IO is high-frequency and disposable, so it does NOT touch the durable event log. Added `apps/host/src/terminal-server.ts` (`createTerminalServer`), mounted on the host's existing loopback HTTP server at **`/terminal`** in `noServer` mode — the same attached-upgrade pattern as the sync hub, registered after it so both upgrade listeners coexist (each ignores the other's path). It is gated by the **same bearer token** (P11; presented via the `?token=` query because a browser WebSocket can't set `Authorization`). On connect it reads `workspaceId/shell/cols/rows/cmd`, resolves the worktree cwd via the store (falls back to home dir), spawns a PTY on the **shared `PtySupervisor`**, and pipes `data`/`resize` in and `data`/`exit` out as small JSON frames (`TerminalClientFrame`/`TerminalServerFrame`, exported from `@swarm/host/daemon`). `cmd` runs a one-shot non-interactive shell command (preset slots); absent ⇒ interactive shell. Teardown tree-kills every spawned terminal PTY before dropping sockets (Windows ConPTY keep-alive hazard); host `shutdown()`'s `killAll()` is a backstop. Host tests stay green (12/12).

## Diff save-back implementation — `packages/git-worktree`
Added real git-diff methods to `WorktreeEngine`: `changes()` (`git status --porcelain` + `git diff --numstat HEAD`, untracked counted from disk), `fileDiff()` (`git show HEAD:<path>` + on-disk read + parsed unified `git diff`, with synthesized whole-file hunks for untracked/deleted), `writeFile()` (real write, traversal-confined to the worktree), and `discardFile()`. Surfaced via a new `diffs` tRPC router in `apps/host/src/trpc.ts`. Covered by 4 new unit tests (modified+untracked listing, real hunks + old/new text, untracked whole-file add hunk, save-back + traversal rejection).

## Deps added (per-package)
- `apps/desktop`: `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `@xterm/addon-search@0.16.0`.
- `apps/host`: `ws@8.21.0` (+ dev `@types/ws@8.18.1`) for the terminal-IO `WebSocketServer`.
- No root config touched beyond lockfile.

## Playwright e2e (real host, via node) — `apps/desktop/e2e/content.spec.ts`
`global-setup.ts` was extended to stand up a **real on-disk git working tree** (`chore/diff-demo`) with one commit + an uncommitted edit, reusing the foundation's startHost pattern. The Electron-in-CI skip is untouched (the harness runs the renderer via `vite preview`, not Electron).
- *opens a terminal and streams real output from the host PTY* — selects the worktree, runs preset 1 (`echo grove-terminal-online` over `/terminal`), asserts the streamed bytes appear.
- *renders a real git diff and saves an inline edit back to the worktree* — asserts the modified `greeter.ts` + its changed line render, then edits, saves via `diffs.writeFile`, and asserts the re-read diff shows the saved content.

```
Running 4 tests using 1 worker
  ✓ content.spec.ts › opens a terminal and streams real output from the host PTY (1.9s)
  ✓ content.spec.ts › renders a real git diff and saves an inline edit back to the worktree (2.0s)
  ✓ shell.spec.ts   › mounts the cockpit chrome and shows the connect state with no host (477ms)
  ✓ shell.spec.ts   › connects to a real host and renders the live workspace list (683ms)
  4 passed (19.1s)
```

## Gate results (local, Windows)
- `bun run lint` (biome) → clean, 166 files.
- `bunx turbo run typecheck build test --force` → **43/43 successful** (run twice: 55.8s, 56.6s).
- Banned-token scan `rg -ni "TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem ipsum|throw new Error\(['\"]unimplemented"` over `apps packages docs` → **clean (exit 1, no matches)**.
- Screenshots: `desktop-terminal.png` (live PTY stream), `desktop-diff.png` (real diff), plus the foundation's `desktop-shell-*.png`.
