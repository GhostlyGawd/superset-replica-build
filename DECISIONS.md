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

## ADR-0011 — Engine conventions + CI-gate lessons (Phase 2)
- **Date:** 2026-06-15 · **Status:** Accepted
- **Context:** Phase 2 (host engine) surfaced three cross-cutting issues during integration that are worth pinning so later phases don't repeat them.
- **Decisions:**
  1. **Explicit `.ts` import extensions everywhere + `allowImportingTsExtensions: true` in `tsconfig.base.json`.** The host engine runs the PTY layer under Node (ADR-0007a), and Node's strip-types execution of worker scripts requires resolvable relative specifiers (explicit extensions). Mixing extensionless library source with `.ts`-extension workers caused TS5097 in consumer packages. Standardizing on explicit `.ts` everywhere is the only convention that works uniformly across bun (tests/bundling), Node (PTY workers), and `tsc` (`noEmit`, since builds use `bun build`, not tsc emit).
  2. **CI-gate discipline: never trust a cached local run.** Local `bun run <task>` goes through the Turbo cache and can return FALSE-GREEN cache hits that hide failures CI catches cold. The gate before any commit is a cache-disabled run: `bun run lint` (root Biome — not a Turbo task) + `bunx turbo run typecheck build test --force`, then confirm the 3-OS CI run after pushing. Per-package green ≠ full-tree green; local green ≠ CI green.
  3. **Windows file-lock resilience: git invocations use bounded transient-only retries.** Under heavy parallel test load (many concurrent PTY/process-spawning suites), git commands (`add`/`commit`/worktree ops) flake on Windows from `index.lock` / in-use-handle / AV contention. The git-worktree engine + fixtures retry only transient errors (errno/stderr signature allowlist) up to 5× with backoff; deterministic errors surface immediately. Real agents on Windows hit the same locks, so this lives in the engine, not just tests.
- **Consequences:** All packages build/run cross-platform under Node + Bun; the commit gate is reliable; the engine is robust to Windows filesystem contention. Recorded after the Phase-2 host engine reached a green 3-OS CI with the parallel-agents integration test (P01/P02/P04/P10/P11) passing.

## ADR-0012 — Phase-3 red CI is a GitHub Actions BILLING block, not a code defect; clean-install repro is the interim gate
- **Date:** 2026-06-15 · **Status:** Accepted (with an EXTERNAL BLOCKER that needs user action)
- **Context:** `main @ 0575214` (Phase-3 desktop foundation + terminal P05/diff P06) showed RED CI on all 3 OSes, and the prior session hypothesised a *clean-install-only code defect* (it could not retrieve CI logs — `gh BlobNotFound`). Re-derivation this session: both failed runs (`27539598023`, `27541523156`) carry the **identical annotation** on all three jobs — *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* The jobs **never started** (2–3 s each → no logs, hence the BlobNotFound). The last actually-executed run was v0.3.0 (`27537264984`, 09:35Z); billing was exhausted before the two desktop pushes. The repo is **private**, so GitHub-hosted Actions minutes (esp. Windows/macOS, billed at 2×/10×) are metered and were cut off.
- **Decision:**
  1. **Root cause = account billing, NOT code.** Proven by a full clean-install repro mirroring CI on this Windows host (`rm -rf` all `node_modules` + `.turbo` + `*.tsbuildinfo`, `bun install --frozen-lockfile`, then `bun run lint` → `typecheck` → `build` → `test`): **ALL GREEN cold** — install ✓, lint ✓ (166 files), typecheck ✓ (17/17, 0 cached), build ✓ (17/17, 0 cached), test ✓ (9/9 task groups; all real PTY/host/worktree/diff integration tests pass). The prior clean-install-defect hypothesis is **refuted**. Prediction `e9ae9e0e` = hit.
  2. **The clean-install repro is the interim gate** while CI is billing-blocked: a cold `rm node_modules+.turbo+tsbuildinfo` + `bun install --frozen-lockfile` + the four CI steps is exactly what CI runs, so a green local cold run is the strongest available proxy. Build work continues against it. **But** macOS/Linux cannot be locally verified, so **no version may be cut and no Linear item marked Done on local-only evidence** — the non-negotiable "green windows+macos+ubuntu CI" stands; those milestones are *staged*, not *closed*, until billing is restored and CI runs green.
  3. **Remediation requires the user (external account state — cannot be fixed in-repo, autonomously, or via `gh`).** Two paths, surfaced to the user: **(a)** raise the Actions spending limit / fix the payment method at github.com/settings/billing; or **(b)** make the repo **public** (free unlimited GitHub-hosted Actions incl. Windows+macOS), which also aligns with the OSS-replica goal — but publishing the source is an outward-facing decision reserved to the user, **not taken autonomously**.
- **Consequences:** Phase 3 (and every later release gate) is **blocked on billing**, not on engineering. The orchestrator continues building + locally-verifying staged work (wave B2, e2e CI job, QA) so that the moment billing is restored, one push validates 3-OS-green and v0.4.0 cuts immediately. STATE.json `blocked` + RESUME.md PRIORITY updated to stop any future re-misdiagnosis.

## ADR-0013 — Desktop wave B2: open-in-external runs on the HOST; single hotkey registry; PGlite-persisted shortcuts (P08/P09)
- **Date:** 2026-06-15 · **Status:** Accepted
- **Context:** Phase-3 wave B2 adds workspace navigation + open-in-external (P08) and customizable keyboard shortcuts + a settings surface (P09) to the desktop renderer, wired to the REAL host (no mocks on user paths). Several design points were decided autonomously per the wave brief.
- **Decisions:**
  1. **Open-in-external executes on the HOST, not the Electron main/renderer.** A new host procedure `workspaces.openExternal({ workspaceId, target: "editor"|"terminal"|"folder" })` opens the worktree via `node:child_process` (NOT a PTY): editor = `$VISUAL`/`$EDITOR` else `code`/`cursor`; terminal = Windows Terminal/`cmd`, macOS `Terminal.app`, Linux `$TERMINAL`/`x-terminal-emulator`/common emulators; folder = `explorer`/`open`/`xdg-open`. **Rationale:** the worktree physically lives on the host, so it must open there — this is correct for both a local host and a future remote host, whereas opening from the Electron main process would only work locally. Binaries are resolved defensively (`resolveExecutable` → `where.exe`/`which`, PATHEXT-aware); launches are detached + unref'd; Windows `.cmd`/`.bat` shims are routed through `cmd.exe`.
  2. **Input field named `workspaceId` (not `id`).** The brief sketched `{ id, target }`; chose `workspaceId` for consistency with every other live-router procedure (`diffs`/`terminal`/`sessions` all key on `workspaceId`) and with the `@swarm/api` contract. Target enum is exactly `editor|terminal|folder`; the `@swarm/api` `ExternalTarget` was aligned from the stale `vscode|cursor|...`.
  3. **`projects.open` validates a REAL git repo, then seeds a worktree.** `projects.open({ path, name? })` runs `git rev-parse --is-inside-work-tree` / `--show-toplevel` / `--abbrev-ref HEAD` (no fake validation), registers the repo as a project idempotently by resolved root, and cuts a first isolated worktree from its current branch via the orchestrator. Repo path is entered as text (a native Electron folder picker is deferred to Phase 5; text entry is portable and works in the browser-served e2e). New / Quick-create reuse `workspaces.create` against the selected workspace's project.
  4. **Single source-of-truth hotkey registry shared by the App shell AND TerminalPanel.** `apps/desktop/src/renderer/shortcuts/registry.ts` defines id → default chord → description; chords are encoded from `KeyboardEvent.code` (layout-independent, capture-friendly). The renderer loads overrides on mount and BOTH keymaps read the merged config. App-level chords (`Ctrl+Alt+↑/↓` prev/next, `Ctrl+Alt+N` quick-create, `Ctrl+Alt+Shift+N` new dialog, `Ctrl+Alt+O` open project, `Ctrl+,` settings) were chosen to never collide with TerminalPanel's `Ctrl+Shift+*` and `Ctrl+1–9`. The numeric preset slots (`Ctrl+1–9`) stay a parametric rule, not nine rebindable entries.
  5. **Shortcuts persisted in PGlite via the existing `hotkey_overrides` table (scope `"desktop"`).** New `settings` router: `getHotkeys`/`setHotkey`/`setHotkeys`/`resetHotkey`/`resetHotkeys`. The store upsert is **delete-then-insert** (not `ON CONFLICT`) because Postgres treats `NULL os_scope` as DISTINCT on the `(action_id, os_scope)` unique index, which would otherwise let a NULL-scoped binding duplicate.
  6. **Dialogs are mounted only while active.** The `@swarm/ui` `Dialog` renders a *closed* native `<dialog>` visibly (its `flex` class overrides the UA `dialog:not([open]){display:none}`), so an always-mounted dialog pollutes the page (intercepts clicks, duplicates accessible names). The renderer conditionally mounts New/Open/Settings dialogs.
  7. **E2E open-external test seam (not a mock).** `GROVE_EXTERNAL_LAUNCH_CAPTURE=<file>` makes the host record the launch it WOULD perform (one JSON line) instead of spawning a GUI app, without requiring the binary to exist — so the real journey is asserted on a headless runner. The fixture project gains a REAL `localPath` repo and a temp `worktreesRoot` so New-worktree cuts a genuine git worktree.
- **Consequences:** P08/P09 land REAL + wired to the host. Local gate green: Biome lint clean; `turbo run typecheck build test --force` 17/17 + 26/26; banned-token scan empty; Playwright e2e 8/8 (4 new B2 + 4 prior) against the real seeded host; new host round-trip tests (`settings-projects.test.ts`) 6/6. Per ADR-0012 these are **staged** (no version cut / no 3-OS CI) until billing is restored.
