# Phase 1 — Brand & Design System — Critic Review

**Critic:** independent (did not build this work). **Date:** 2026-06-14.
**Verdict: PASS.** All §6.3 gate criteria PASS (5/5 top-level; every sub-item PASS).
Tailwind v3.4 pin (vs original v4) explicitly not failed per ADR-0008.

## §6.3 — Anti-slop design bar (the gate)

| # | Criterion | Result | Proof inspected |
|---|---|---|---|
| 1 | Stated original design thesis (POV + references + what it avoids) | PASS | `docs/design-system.md` §1 thesis "calm surface, swarming depth"; references list (Linear, Vercel/Geist, Raycast, Bloomberg/cockpit/NASA, IBM Plex/Carbon, TUI heritage) L26-35; explicit AVOIDS list L37-47 names purple/indigo gradients, emoji iconography, shadcn defaults, glassmorphism. `docs/brand/README.md` carries name story + voice. |
| 2a | Real type scale w/ rationale | PASS | `design-system.md` §2 (IBM Plex Sans+Mono superfamily rationale, one hand/shared skeleton, engineered for 11-14px); 8-step scale L67-76; mirrored in `tokens.ts` TYPE_SCALE L234-243; rendered specimen visible desktop-dark.png (type-scale block) + phone-dark.png. |
| 2b | Deliberate accessible color system w/ STATE SEMANTICS | PASS | §3.1 surface/elevation roles; §3.2 state table idle=slate/running=cyan/attention=amber/error=red/success=green/info=blue, each ships solid+fg+bg+border; `status.ts` triple-encodes color+label+shape; `tokens.ts` darkColors/lightColors L65-139. Palette + state swatches rendered in desktop-dark.png. |
| 2c | Spacing / radii / elevation tokens | PASS | §4 + `tokens.ts` SPACE (4px grid) L205-220, RADII (5px default control) L223-231, ELEVATION L246-250. |
| 2d | Motion language w/ purpose + reduced-motion | PASS | §5 + `tokens.ts` MOTION L253-264 (instant/fast/base/slow, standard/exit easing, no spring); `styles.css` keyframes L91-166, sole loop = `grove-pulse`; `@media (prefers-reduced-motion: reduce)` L172-186 collapses transitions and stops pulse+shimmer. |
| 3 | Forbidden defaults ABSENT | PASS | Gradient scan: only one `linear-gradient` (`styles.css:158`) = skeleton shimmer using neutral `--color-bg-raised`/`--color-line`, NOT a hero. Purple/indigo scan: zero in source (only mention is the AVOIDS line in the doc). Emoji scan: only ✓/✗/❯ inside the simulated terminal stream (`apps/showcase/src/data.ts`, authentic terminal content) and → arrows in comments — no emoji feature cards, no emoji-as-icon (UI icons are lucide-react). Screenshots show a dense operator console, not a centered marketing hero. |
| 4 | Coherence & craft; real empty/loading/error; dev-tool density; pixel polish both breakpoints | PASS | Components present: `EmptyState.tsx`, `ErrorState.tsx`, `Spinner.tsx`, plus `grove-skeleton`; `Button` loading+aria-busy. desktop-dark.png: workspace rail w/ 5 status states, real PowerShell terminal (`agent paused — waiting on your input to continue`), gutter-aligned diff +4/-1 with add/remove tints. phone-dark.png @390px: bottom nav (Workspaces/Terminal/Diff), horizontal-scroll tabs, taller touch controls, no overflow/clipping. |
| 5 | Functional & fast; design serves dense real-time multi-agent workflow | PASS (design intent) | Thesis + composed console demonstrate density/legibility for 10-100+ agents; short motion durations (80-240ms) chosen for instant feel. Runtime speed budgets (§6.4) are out of scope this phase. |

## §6.4 — Applicable dimensions (this stage)

| Dimension | Score | Note |
|---|---|---|
| Frontend design | Above bar | Original, coherent, dense; escapes default-AI look. |
| Tooling/language | Above bar | Framework-agnostic token contract + `react/*` split; hand-built on platform primitives (native `<dialog>`, native `<select>`); OSS fonts/icons (ADR-0008). |
| UX | Above bar | Keyboard-first, roving-tabindex Tabs (Arrow/Home/End), real product copy, status triple-encoding, phone bottom-nav + touch sizing. |
| Accessibility | Above bar | WCAG AA enforced in CI (`bun test` 60 pass / 0 fail); focus-visible rings w/ offset; ARIA wiring (labelledby/describedby/invalid/busy/selected/controls); not-color-alone; reduced-motion; label association (no label-by-hint). |
| Docs | At bar | Thorough design-system + brand + ADRs. Minor inaccuracy: doc says "all 60 documented pairs" but `CONTRAST_CLAIMS` is 52 pairs (60 = total test count incl. math/scale tests). |

## Independently verified (executed, not merely read)
- Banned-token scan `rg -ni "TODO|FIXME|..."` over apps/packages/docs → no matches (exit 1). CLEAN.
- `bun test packages/ui/src/tokens.test.ts` → **60 pass, 0 fail, 121 expect() calls**. Contrast assertions are real: `expect(ratio(fg,bg)).toBeGreaterThanOrEqual(claim.min)` over 52 pairs, min=4.5 text / 3 non-text, both themes; `contrast.ts` implements correct WCAG-2.1 relative-luminance math (verified black/white→21:1).
- Gradient + purple/indigo + emoji greps (above) confirm no forbidden defaults.
- Screenshots viewed (incl. cropped detail): desktop-dark/light, phone-dark/light — original, crafted, no clipping at 390px.
- Brand SVGs exist and are hand-authored: `docs/brand/assets/grove-mark.svg` (role/title/desc, monoline 2.4 stroke, 3 accent nodes), `grove-wordmark.svg`.

## Required fixes
None block the phase. Optional, non-blocking:
1. Correct the "60 documented pairs" phrasing in `design-system.md` §3.3 to "52 pairs / 60 tests" (or expand claims to 60 actual pairs).
2. (Thoroughness) `fg-subtle` AA is asserted only on `surface`; add claims on `raised`/`overlay` where hint/meta text also renders.
