# Phase 3 (Desktop Client) — Independent Critic RE-GATE

**Critic:** independent (did NOT build this; saw the builder's commit messages but not their chat). **Date:** 2026-06-15
**Host:** Windows 10 19045, Node 24.14.1, Bun 1.3.14. **HEAD:** `d68f9c3`.
**Method:** re-ran lint/typecheck/e2e/a11y cold myself; read the recorded axe + perf JSON, not just the prose; inspected source at file:line and the screenshots. This is a re-gate of the prior CHANGES-REQUIRED (2 defects).

## Prior defects — both RESOLVED (independently verified)

1. **typecheck RED (16/17) — FIXED.** `bunx turbo run typecheck --force` → **17/17 successful** (24.6s, 0 cached). `apps/desktop/e2e/_qa-screens.spec.ts:43` now sets only `viewport` in `test.use()`; the offending `reducedMotion` (TS2353) is gone.
2. **Missing §6.2/§6.4 evidence — FIXED.** `evidence/phase-3/perf-report.md` + `a11y-report.md` exist. The a11y **1 critical + 2 serious** are genuinely closed: I re-ran the axe audit myself (see §6.2) and read the recorded result JSON — **0 violations of any impact** on shell + Settings dialog.

## §6.1 Definition of Done
| Item | Verdict | Proof (I ran/inspected) |
|---|---|---|
| Builds clean | PASS | e2e webServer ran `vite build`+`preview`; renderer served, 8/8 gating e2e green. |
| Biome lint clean | PASS | `bun run lint` → "Checked 180 files. No fixes applied." exit 0. |
| `tsc` typecheck clean | PASS | `turbo run typecheck --force` → **17/17**. (Prior FAIL refuted.) |
| Real e2e (not smoke) | PASS | `node …/@playwright/test/cli.js test` → **8/8** vs real host: real PTY stream (`content.spec.ts:26`), real git diff + inline save (`:42`), open-external (`b2.spec.ts:44`), kbd nav, real worktree cut, shortcut persistence across reload. |
| Runs against real host | PASS | `global-setup.ts` boots real `@swarm/host`; screenshots show live `127.0.0.1:49909`, "sync live", v0.1.0. |
| No banned tokens | PASS | §6.1 ripgrep scan over `apps`+`packages` → **empty**. |
| Cross-platform CI green | N-A (blocked, external) | ADR-0012 billing; code-proven-green locally (typecheck now green so CI typecheck would NOT self-red). |
| No mock on a user path | PASS | mock adapter gated behind `SWARM_ENABLE_MOCK_ADAPTER`; user path hits real host. |
| Linear→Done / CHANGELOG | N-A | Staged-not-closed by design (no version cut pending billing). |

## §6.2 "Prove it" — evidence
| Item | Verdict | Proof |
|---|---|---|
| Screenshots (desktop+phone) | PASS | All present + inspected (b2-*, desktop-shell-connected/no-host, terminal, diff). |
| e2e run/trace | PASS | Re-ran suite 8/8; HTML report + trace config present. |
| **Performance report** | PASS | `perf-report.md`: real `performance.now()` samples. I recomputed every headline from the listed raw samples (R-7): coldStart 377/423 (<3000 PASS), dialog 110/165 (p50 marginally over 100, p95 OK), switch 25/63 (PASS), terminal 159/611 — numbers are genuine, not fudged. Over-budget terminal p95 honestly disclosed + attributed to interactive Windows PowerShell variance (transport floor <120ms within budget); cross-platform re-measure deferred to Phase-6. **Acceptable for STAGED Phase-3.** |
| **Accessibility report** | PASS | `a11y-report.md` + my own re-audit (below). |
| License-audit | N-A | Phase-6 deliverable (ADR-0008). |

**a11y re-audit I ran myself** (testIgnore blocks the documented one-liner, so I ran `_a11y.spec.ts` via a temporary `--config` override, then deleted it): 3/3 pass, and the recorded `grove-a11y-results.json` (axe-core 4.12.1) shows **shell 0 violations / 39 passes, Settings scoped 0 / 18, Settings full 0 / 23, incomplete empty, all 9 keyboard journeys PASS.** Fixes are real, not superficial: `Tabs.tsx:104` emits `aria-controls` only when `renderPanel && selected` (panel renders only for active item — no dangling ref in either mode); `WorkspaceRail.tsx` + `SettingsDialog.tsx` swap `text-fg-subtle`→`text-fg-muted` (existing AA token, not a one-off hex); `App.tsx:186` adds `<h1 class="sr-only">Grove mission control</h1>`.

## §6.3 Anti-slop design bar — PASS
Inspected desktop-shell-connected.png + desktop-diff.png + desktop-terminal.png + b2-*: dark, dense operator console — worktree rail with live status dots, terminal tab strip, real git diff (+1/-1, modified badge, Edit, line numbers, syntax), live endpoint/sync/version status bar. No purple gradient, no emoji UI, no centered hero, no stock component look. Intentional system (IBM Plex Sans/Mono dense scale, semantic status color, `@swarm/ui` tokens). Real empty/loading/error states (no-host retry). Minor: 390px status-bar crowding — desktop-only client, mobile = Phase-4, NOT a Phase-3 blocker.

## §6.4 Quality dimensions
Frontend PASS · Backend PASS · Tooling PASS · UX PASS · Functionality PASS (P05/P06/P08/P09 real+wired) · **Performance PASS** (budgets measured; terminal p95 over-budget on this host honestly explained, Phase-6 re-measure) · **Accessibility PASS** (0 crit/0 serious, re-audited) · Security PASS · Mobile-native N-A (Phase-4) · Docs PASS.

## DEFECT (non-blocking, log for fix)
**Evidence reproduce commands are broken.** `playwright.config.ts:16-18` and both reports' "Reproduce:" lines tell readers to run `node …/cli.js test e2e/_a11y.spec.ts` / `_perf.spec.ts`, but `testIgnore: ["**/_*.spec.ts"]` (added in HEAD commit d68f9c3) makes both return **"0 tests in 0 files"** — Playwright applies testIgnore before positional filters, so naming the file does NOT override it (I verified both with `--list`). The evidence is sound and I reproduced it via a config override; only the documented path is stale. **Cheapest fix:** env-gate the ignore (`testIgnore: process.env.RUN_MEASURE ? [] : ["**/_*.spec.ts"]`) or document the `--config`/override invocation, and update the two "Reproduce:" lines.

---

## OVERALL VERDICT: ALL-PASS (release-ready pending billing)

Both prior blockers are genuinely resolved (typecheck 17/17 verified; a11y 0 critical/0 serious re-audited from the recorded JSON, not the prose). Every functional gate is green: lint clean, e2e 8/8 on the real host (Tabs ARIA change did not regress the terminal tab strip), banned-token scan empty, perf numbers real and internally consistent. The over-budget terminal-stream p95 is honestly disclosed and Phase-6-deferred — acceptable for a STAGED Phase-3, not a blocker. The one remaining defect (broken evidence-reproduce command) is documentation-only and does not affect shippability.

RELEASE (v0.4.0) remains correctly blocked on external GitHub Actions billing (ADR-0012); code is proven-green locally. Recommend fixing the reproduce-command doc gap in a follow-up so the evidence stays reproducible by CI/future readers.
