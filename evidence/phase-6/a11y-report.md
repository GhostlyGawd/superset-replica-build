# Phase-6 Accessibility Report (spec §6.2 — desktop + mobile, post a11y SOURCE fixes)

> **Re-audit (2026-06-16): 0 critical / 0 serious / 0 moderate / 0 minor on BOTH desktop and
> mobile.** Phase 6 Wave-1 landed the three a11y SOURCE fixes from DECISIONS.md ADR-0018 in
> `@swarm/ui` (the only product code change). The systemic `text-fg-subtle`-on-raised/overlay
> contrast bug — deferred from Phase 3/4 and worked around per-consumer — is now fixed at the
> token, so the Phase-4 lone serious (`color-contrast` on the sheet/dialog section `<h3>`
> headings) is **gone at the source**, and the per-consumer `text-fg-subtle → text-fg-muted`
> dodges were reverted back to `text-fg-subtle` (now AA-passing on overlay/raised).

Automated `axe-core` audit (plus, on mobile, touch-target sizing and a keyboard/AT-reachability
pass) of the Grove **desktop renderer** (`apps/desktop`) and **mobile PWA** (`apps/mobile`), run
against the **real**, connected/paired host (real host: tRPC + `/sync` + PTY; on mobile also
`pair.redeem`; **no mocks** on any user path). Surfaces include the overlay surfaces that the
fix targets: the desktop **Settings dialog** and the mobile **workspace-detail sheet**.

## What changed in Phase-6 Wave-1 (the fixes proven here)

1. **(a) Systemic `fgSubtle` AA on raised + overlay.** Dark `fgSubtle` lightened
   `#828d88 → #8b958f` in BOTH `packages/ui/src/tokens.ts` and `packages/ui/src/tokens.css`
   (they mirror). Authoritative ratios via the repo's own `packages/ui/src/contrast.ts`
   `ratio(fg,bg)`:

   | dark `fgSubtle` | on `overlayBg` #212826 | on `raisedBg` #1a201e | on `surfaceBg` #141817 |
   |---|---|---|---|
   | old `#828d88` | **4.38 — FAILS AA** | 4.82 | 5.21 |
   | **new `#8b958f`** | **4.87 — PASS** | **5.35 — PASS** | **5.79 — PASS** |

   New value stays clearly more subtle than `fgMuted #aab4af` (7.06:1 on overlay), so the
   text hierarchy survives. `tokens.test.ts` was extended with `fg-subtle on raised` and
   `fg-subtle on overlay` claims (min 4.5) generated for BOTH themes by `claimsFor(...)`; the
   light theme (`fgSubtle #677069`) already passed and was not touched (overlay/raised 5.12 /
   4.98). Token test: **64/64 pass** (was 60; +4 new claims × dark/light).

2. **(b) Closed Dialog/Sheet is `display:none` when not `[open]`.**
   `packages/ui/src/react/Dialog.tsx` emitted the Tailwind `flex` display utility
   unconditionally, overriding the UA `dialog:not([open]){display:none}`, so a closed,
   always-mounted Dialog/Sheet painted full-bleed and stole input. Fixed at the source:
   `open ? "flex" : "hidden"` (closed → `display:none` wins; open → flex column). The
   `useEffect` driving `showModal()`/`close()` was switched to `useLayoutEffect` to also kill
   the one-frame open-flash (client-only app — no SSR warning). New DOM/markup unit test
   `packages/ui/src/react/Dialog.test.tsx` asserts a CLOSED `<Dialog open={false}>` resolves to
   `hidden`/not-visible and an OPEN one to flex (incl. the `Sheet` variant): **5/5 pass**.

3. **(c) TerminalFrame inert mobile Find/Split buttons.**
   `packages/ui/src/react/TerminalFrame.tsx` gained explicit `showFind` + `showSplit` booleans
   (default `true`, so desktop + showcase are unchanged); the mobile consumer
   `apps/mobile/src/host/terminal/TerminalView.tsx` now passes `showFind={false}
   showSplit={false}`, so the phone terminal no longer renders Find/Split buttons that do
   nothing.

## Methodology

- **Harnesses:** `apps/desktop/e2e/_a11y.spec.ts` and `apps/mobile/e2e/_a11y.spec.ts` —
  measurement specs (the `_` prefix gates them behind `GROVE_E2E_MEASURE=1`; the default e2e
  run excludes them). Each injects the `axe-core` source
  (`page.addScriptTag({ path: require.resolve("axe-core") })`), runs `axe.run()` over the live
  DOM, and records pass/violation counts to a JSON file in the OS temp dir (a real gap is
  reported, not aborted on; the only hard assertion is that axe ran).
- **Engine:** `axe-core` 4.12.1 (MIT), rule set `wcag2a, wcag2aa, wcag21a, wcag21aa,
  best-practice`.
- **Viewports:** desktop — default Playwright Chromium; mobile — **Pixel 5** (393×727 CSS px,
  dpr 2.75, `isMobile`/`hasTouch`).
- **Surfaces audited:** desktop — connected main shell + **Settings dialog open** (scoped to
  `dialog[open]` and full-page). mobile — paired shell (workspace list) + **workspace-detail
  sheet open** (real branch + git status + live agent, scoped + full-page).
- **Run:** `GROVE_E2E_MEASURE=1 node ./node_modules/@playwright/test/cli.js test _a11y.spec.ts`
  from each app. **Machine:** Windows 10 `10.0.19045`, Chromium via Playwright `1.60.0`. Real
  host booted by `e2e/global-setup.ts`. Generated `2026-06-16T14:00Z`.

## axe-core results — violations by impact

### Desktop (`apps/desktop`)

| Surface | Rules pass | Violations | Incomplete |
|---|---|---|---|
| Connected main shell | 39 | **0** | 0 |
| Settings dialog — scoped to `dialog[open]` | 18 | **0** | 0 |
| Settings dialog — full page (modal open) | 23 | **0** | 0 |

**0 critical, 0 serious, 0 moderate, 0 minor.** Keyboard/dialog-focus pass: **9/9** (prev/next
worktree, open Settings via Ctrl+Comma, focus-trap entry, Tab stays trapped, Escape closes,
New/Open dialogs via chord, terminal preset slot streams).

### Mobile (`apps/mobile`)

| Surface | Rules pass | Violations | Incomplete |
|---|---|---|---|
| Paired shell (workspace list) | 27 | **0** | 0 |
| Workspace-detail sheet — scoped to `dialog[open]` | 24 | **0** | 0 |
| Workspace-detail sheet — full page (modal open) | 28 | **0** | 0 |

**0 critical, 0 serious, 0 moderate, 0 minor.** This is the direct proof of fix (a): the
**Phase-4 serious `color-contrast` on the sheet section `<h3>` headings is resolved** — those
labels are back on `text-fg-subtle` (the intended weight), now AA-passing on the overlay
surface (4.87:1).

#### Touch targets (≥44px) — all PASS, `undersized` empty

| Group | Control(s) | Size (w×h px) | Verdict |
|---|---|---|---|
| BottomNav | Workspaces, Agents, Terminal, Diff, Settings | 79×53 each | **PASS** |
| Primary action | Dispatch (panel-header) | 90×44 | **PASS** |
| Accessory bar | Ctrl, Esc, Tab, ←, ↑, ↓, →, Enter | 44–73 × 44 each | **PASS** |

(The Phase-4 32 px Dispatch button was already fixed to `min-h-11` in Phase 4; re-confirmed
44 px here.)

#### Keyboard / AT reachability — pairing flow: 4/4 PASS

Accessible label on the pairing-code field; `Tab` reaches the input then the "Link this phone"
submit; typing a code + `Enter` submits via keyboard alone.

## Verdict

**No critical and no serious violations on either surface**, including the overlay surfaces
(desktop Settings dialog, mobile workspace-detail sheet) that the `fgSubtle` fix targets. The
systemic contrast bug is fixed at the token (not per-consumer), the closed-overlay quirk is
dead (a closed Dialog/Sheet is `display:none`), and the inert mobile Find/Split buttons are
gone. `incomplete` (needs-review) buckets are empty in every context.

## Reproduce

```
# desktop
cd apps/desktop && GROVE_E2E_MEASURE=1 node ./node_modules/@playwright/test/cli.js test _a11y.spec.ts
# mobile
cd apps/mobile  && GROVE_E2E_MEASURE=1 node ./node_modules/@playwright/test/cli.js test _a11y.spec.ts
```

Results are written to `grove-a11y-results.json` (desktop) and `grove-mobile-a11y-results.json`
(mobile) in the OS temp dir. The `@swarm/ui` token contrast claims are enforced deterministically
by `packages/ui/src/tokens.test.ts` (`bun test` in `packages/ui` → 64/64), so the raised/overlay
AA claims fail the build if ever regressed.
