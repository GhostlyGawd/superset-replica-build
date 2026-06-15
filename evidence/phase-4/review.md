# Phase-4 (Mobile-native PWA) — Critic Review

**Critic:** independent (did NOT build this). **Repo HEAD:** `d41c039`. **Date:** 2026-06-15.
**Method:** verified mechanically (ran lint/typecheck/e2e/a11y, parsed result JSON, read source
and judged all eight `m-*.png` screenshots), not from builder prose. CI greenness across the
3-OS matrix is accepted from provided context (workflow present; not re-triggered here).

## §6.1 Definition of Done

| Item | Verdict | Proof inspected |
|---|---|---|
| Biome lint clean | **PASS** | `bun run lint` → "Checked 239 files… No fixes applied", exit 0 |
| `tsc` typecheck clean (no `any`-escapes) | **PASS** | `bunx turbo run typecheck --force` → 17 successful / 17 total, exit 0 |
| Builds clean | **PASS** | typecheck 17/17 + e2e `global-setup.ts:buildPwa()` builds the real PWA the host serves (11/11 e2e depend on it). Full `turbo run build` not separately re-run. |
| Real Playwright e2e of the journey vs real host | **PASS** | `node …/playwright test` → **11 passed (44.6s)**: pairing(single-use redeem→real list), read journeys (real branch/gitStatus/live agent, Agents roll-up, real diff), terminal (real PTY echo + accessory bytes), dispatch (real generic agent appears live), SW/install, push opt-in+inbox |
| Runs against the REAL host | **PASS** | `global-setup.ts:7,130` imports `startHost` from `@swarm/host/daemon`, boots a real daemon serving the built PWA same-origin; no stubbed happy path |
| No banned tokens | **PASS** | rubric rg scan → empty (exit 1, no matches) |
| No mock masquerading as a feature | **PASS** | `DispatchSheet.tsx` calls `agents.start` with adapter from `BUILTIN_ADAPTERS` (no `mock`); `trpc.ts:189-200` never forwards `enableMock`; `orchestrator.ts:272-277` throws on `mock` unless `SWARM_ENABLE_MOCK_ADAPTER`/`enableMock`. The lone `enableMock:true` (`host-worker.ts:221`) is inside the standalone `main()` seed/benchmark script, not the request path |

## §6.2 Evidence

| Artifact | Verdict | Proof |
|---|---|---|
| Screenshots `m-*.png` (8) | **PASS** | pairing, workspaces, detail, agents, diff, terminal+accessory, dispatch, notifications all present and inspected |
| `perf-report.md` | **PASS** | real `performance.now()` samples w/ raw arrays; cold-start p50 115ms/p95 229ms (<3000), tab 55/64, sheet 58/74, terminal 45/57 — all PASS with disclosed scope (phone viewport, one Windows host; on-device → Phase 6) |
| `a11y-report.md` | **PASS** | axe 4.12.1, 0 crit/0 serious post-fix; matches emitted JSON |
| Green 3-OS CI + e2e-mobile job | **PASS (by context)** | `ci.yml:31` `[windows-latest, macos-latest, ubuntu-latest]` + `e2e (mobile, ubuntu-latest)` job:115; latest-run greenness accepted from provided context, not re-triggered |

### A11y blockers — genuinely fixed (verified two ways)
- `GROVE_E2E_MEASURE=1 … test _a11y.spec.ts` → 4 passed. **Note:** these specs are
  assertion-light (only assert "axe ran" / "targets measured"), so the green run alone does NOT
  gate 0-serious — verified the substance via the emitted `grove-mobile-a11y-results.json`:
  `shell/detailSheet(scoped+full) violations: []`, `touch undersized: []`.
- Code: `SectionLabel` `<h3>` → `text-fg-muted` in `WorkspaceDetailSheet.tsx:30` + `SettingsPanel.tsx:8`;
  `NotificationsCard.tsx:169` "Inbox" → `text-fg-muted`. Dispatch button `App.tsx:131` `min-h-11`;
  JSON shows Dispatch measured **90×44** (was 32). Both blockers resolved.

## §6.3 Anti-slop DESIGN bar — **PASS**
`docs/design-system.md` present with stated thesis + "deliberately avoids" section. Across all eight
phone screens: one intentional green-accent system; state-color semantics (green Active/Live, cyan
Running, amber Needs-attention/changed, red Disconnect/diff-removed) — not random hues; monospace
for branches/code/diff; consistent card/pill/sheet/segmented-tab components; real loading (Spinner),
empty ("1 running · 1 total"), and error (`ErrorState`) states; unified syntax-highlighted diff and
live xterm with a touch accessory bar; bottom-nav + safe-area; touch targets ≥44px (verified). No
forbidden defaults (no centered hero, no purple/indigo gradient, no emoji feature cards, no stock
component dumps). Developer-tool density at the phone breakpoint. Clears the bar.

## §6.4 Quality dimensions — **PASS**
Frontend/UX/Mobile-native feel: dense, coherent, touch-first (screenshots). Backend/Security:
pairing is single-use + TTL-swept + `timingSafeEqual` + lockout + rejection-sampled mint
(`pair.ts`); bearer handed out only by public `pair.redeem` (`trpc.ts:154-158`), stored only in
IndexedDB (`connection-store.ts:14`), never in QR/URL; SW `NetworkOnly` for `/trpc //sync /terminal
/healthz pair.*` + any Authorization request, precache app-shell only (`sw.ts:29-49`). Performance:
budgets met (§6.2). Accessibility: 0 crit/0 serious, keyboard-reachable pairing. Push: host
subscribe→send path tested (`push.spec.ts` e2e green; `notifications.test.ts` present); on-device
display deferred to Phase 5 per ADR-0014 — **N-A** as a Phase-4 blocker.

## Verdict: **ALL-PASS — ready to cut v0.5.0**
No mock on a user path; design clears §6.3; both a11y blockers genuinely fixed (code + JSON).
Non-blocking transparency notes carried forward (not fix-gates): (1) the `_a11y`/`_perf` specs are
measurement tools, not hard gates — the substance lives in the emitted JSON, keep reading it in
review; (2) full `turbo run build` not separately re-run by the critic (typecheck 17/17 + e2e
buildPwa cover it); (3) systemic `text-fg-subtle`-on-raised token sweep + on-device push/perf =
already logged Phase-6/Phase-5 follow-ups.
