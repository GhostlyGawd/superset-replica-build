# HANDOFF — Grove v1.0.0

**Grove** — _Mission control for a swarm of CLI coding agents: calm surface, swarming depth._
Parallel CLI-agent orchestration over isolated git worktrees — cross-platform, self-hosted, OSS —
running natively on **Windows 10/11 + macOS + Linux**.

- **Status:** **v1.0.0 — shipped** (2026-06-16). All 14 parity items **P01–P14 ✅**. Green on
  Windows + macOS + Linux (CI run `27626509741`). Independent Phase-6 Critic **ALL-PASS**.
- **Repo:** `github.com/GhostlyGawd/grove` · **Linear:** "SWARM / Grove" (id in `STATE.json`).
- **License:** MIT (`LICENSE`). OSS-only, no paid SaaS, no mandatory API keys (`evidence/phase-6/license-audit.md`).

## Re-derive the whole project from the blackboard (not chat history)

`RESUME.md` (handoff index) + `STATE.json` (where the build is) + `DECISIONS.md` (every ADR /
ambiguity resolution) + `PARITY.md` (the P01–P14 checklist + evidence) + `RUBRIC.md` (the
Definition-of-Done / anti-slop bar) + `evidence/<phase>/` (proof). These are the source of
truth; the build was run so they fully reconstruct context without any chat log.

## Architecture (one headless host, thin clients)

- **`apps/host`** — the headless engine + daemon. Hono + tRPC over a 256-bit **bearer**
  (private-by-default, loopback bind; `--lan`/`--host` opt-in). Owns: the git-**worktree**
  orchestrator, the **node-pty** PTY supervisor (`@homebridge/node-pty-prebuilt-multiarch`,
  **runs under Node not Bun** — ADR-0007a), **PGlite** (embedded Postgres/WASM, ADR-0003) via
  Drizzle, the **WebSocket sync** event-log, agent **adapters** (Claude Code / Codex / Cursor /
  Gemini / generic any-CLI), `notifications` + **VAPID** Web Push, and the **pairing** router.
- **`apps/desktop`** — Electron + React renderer on `@swarm/ui`, wired to the **real** host:
  terminal (P05), diff + inline edit (P06), open-in-external (P08), nav + shortcuts/settings (P09).
  Packaged via electron-builder (NSIS/dmg/AppImage).
- **`apps/mobile`** — installable offline-first **PWA** on `@swarm/ui` + the real host (P12):
  QR single-use-code pairing (bearer in IndexedDB), read journeys, touch terminal + accessory
  bar, dispatch, injectManifest service worker + Web Push.
- **`apps/cli`** — the `grove` command: `up` (one-command bootstrap), `start`/`stop`/`status`
  (daemon lifecycle), `pair [--remote]` (QR pairing + cloudflared tunnel), `host`.
- **`packages/`** — `@swarm/ui` (design system + tokens), `api` (tRPC contract), `db`,
  `git-worktree`, `pty-supervisor`, `agent-adapters`, `sync`, `config`, `core-engine`, `shared`.
- **Stack (all OSS, ADR-0008):** Bun + Node 24, Turborepo, Vite, Biome, tRPC + Hono, PGlite +
  Drizzle, React + Tailwind, Electron, PWA; cloudflared/localtunnel + Caddy (remote, ADR-0017).

## Build / run / test

```bash
bun install --frozen-lockfile
bun run lint && bun run typecheck && bun run build && bun run test   # the CI gate (verify job)
```
- **Pre-push gate (ADR-0011/0012):** a local `turbo --force` is NOT CI. Gate every pushed HEAD
  with a **clean install** (rm `node_modules` + `.turbo` + `*.tsbuildinfo` → `bun install
  --frozen-lockfile` → the four steps above) and then confirm the **3-OS CI** run. `bun run test`
  caps `turbo` test concurrency at 2 (small-runner event-loop starvation).
- **Run it:** `bun link` in `apps/cli` (or run `node apps/cli/src/index.ts <verb>`), then
  `grove up` → scan the QR. See `docs/getting-started.md` (desktop, phone, and phone-only
  `--remote`) and `docs/demo.md` (a guided tour of all 14 parity items).
- **CI** (`.github/workflows/ci.yml`): `verify` ×3 OS + `e2e (desktop)` + `e2e (mobile)` (real
  host, Playwright via Node) + `package` ×3 OS (`electron-builder --dir`). The desktop e2e job
  also runs the report-only Linux **perf** measurement.

## Parity (P01–P14) — all ✅, see `PARITY.md` for evidence

P01 parallel exec · P02 worktree isolation · P03 agent adapters · P04 monitoring/notifications ·
P05 terminal · P06 diff+inline edit · P07 presets · P08 open-in-external · P09 nav+shortcuts ·
P10 client/host sync · P11 private-by-default · P12 mobile-native control · P13 self/remote setup ·
P14 native Windows/macOS/Linux. Evidence per phase in `evidence/phase-0..6/` (CI links,
screenshots, perf + a11y reports, and each phase's independent Critic `review.md`).

## Known residuals & follow-ups (all documented + accepted at v1.0.0)

- **Security** (`evidence/phase-6/security-review.md`, no High/Critical): default-permissive
  CORS + WS bearer-in-`?token=` (the bearer is the gate; loopback default; no token logging);
  unsigned installers (SmartScreen/Gatekeeper disclosed — acquire a signing cert when budget
  allows); dev-only `esbuild` advisories via drizzle-kit/vite (bump opportunistically).
- **License** (`evidence/phase-6/license-audit.md`): `web-push` is MPL-2.0 (weak copyleft, used
  unmodified); the default remote tunnel is Cloudflare's free TryCloudflare (localtunnel MIT
  fallback keeps it fully OSS).
- **Perf:** on the Windows dev host the interactive PowerShell terminal-stream tail (p95 611 ms)
  is a host-shell characteristic, not Grove transport — Linux p95 is 43 ms (`perf-report.md`).
- **`grove` bin:** real via `bun link` / from-repo invocation; the product isn't published to a
  registry, so there is no `npx grove`. A published bin is a natural post-1.0 step.
- **a11y:** one intentional non-revert — the `WorkspaceRail` selected-row label stays
  `text-fg-muted` (it sits on `bg-accent-bg`, where `fg-subtle` = 4.46 fails AA; that was an
  accent-surface dodge, not raised/overlay).

## Where decisions live + how to extend

Resolve any new ambiguity by appending an **ADR to `DECISIONS.md`** (no human round-trip — the
build's operating rule). Update the blackboard (`STATE.json`/`PARITY.md`) as you go. Every phase
ends with an **independent Critic** (fresh context, did NOT build it) writing
`evidence/<phase>/review.md`; nothing is "done" on a builder's word. Keep `@swarm/ui` the single
UI layer, OSS-only, no banned tokens, no mocks on user happy paths, and prove Windows by green
`windows-latest` CI.
