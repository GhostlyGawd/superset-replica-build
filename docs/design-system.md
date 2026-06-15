# Grove — Design System

The visual and interaction system for **Grove** (codename SWARM): a 1:1, cross-platform, OSS
replica of Superset. Grove orchestrates swarms of CLI coding agents in parallel across isolated
git worktrees, with a live terminal, diff viewer, and real-time multi-agent monitoring — on
desktop and phone.

Implemented in `packages/ui` (`@swarm/ui`). The token contract is `@swarm/ui` (framework-
agnostic); React primitives are `@swarm/ui/react`; the Tailwind preset is
`@swarm/ui/tailwind-preset`; the CSS variable layer is `@swarm/ui/tokens.css` +
`@swarm/ui/styles.css`. The browsable proof is `apps/showcase`.

---

## 1. Thesis

**Grove is mission control for a swarm of coding agents — calm surface, swarming depth.**

A dense, dark-first operations console, built like an aircraft glass cockpit or a trading
terminal, not a landing page. The chrome recedes so that the work — terminals, diffs, and the
live state of every agent — *is* the interface. Color is reserved for signal; type is engineered
for legibility at small sizes; motion communicates state and origin, never decoration. The
defining tension is the product itself: a serene, ordered surface laid over genuinely parallel
chaos (10–100+ agents at once). That tension is the point, and every token serves it.

### References (what we are learning from)

- **Linear** — restraint, density, keyboard-first, a muted palette with surgical accent use.
- **Vercel/Geist and Raycast** — dark developer surfaces, crisp focus rings, monochrome plus a
  single semantic accent.
- **Bloomberg terminal, aircraft glass cockpits, NASA mission control** — information density;
  color strictly as status; everything legible at a glance.
- **IBM Plex / Carbon** — engineered type and grid discipline; "good design is honest."
- **TUI heritage — xterm, tmux, k9s, lazygit** — monospace truth and ANSI semantics, the
  lineage this tool descends from.

### What Grove deliberately AVOIDS

- A centered marketing hero; **purple/indigo gradients**; **emoji as UI iconography** or
  feature cards.
- Unmodified shadcn / component-library defaults; "stock everything"; the default AI-build look.
- Glassmorphism and heavy blur, neumorphism, drop-shadow soup, "friendly SaaS" rounded-everything.
- Decorative motion, parallax, bounce/spring easing as ornament, anything that auto-plays.
- Light-mode-first thinking (Grove is dark-first; light is the considered secondary).
- Low-contrast "elegant" gray-on-gray that fails WCAG; full-saturation backgrounds; color used
  as decoration rather than as state.
- Filler copy. Every label, empty state, and error in the system is real product language.

---

## 2. Typography

**Pairing: IBM Plex Sans (UI) + IBM Plex Mono (terminal, diff, code, metrics).** Both via
Fontsource under the SIL Open Font License (OSS, per ADR-0008).

**Rationale.** One superfamily, two voices. IBM Plex Sans and Plex Mono were designed together
by the same hand on a shared humanist-grotesque skeleton, so a UI label and a line of code read
as one system rather than two fonts in a trench coat. Plex was engineered by IBM explicitly for
software and screens; it stays crisp at the 11–14px sizes a dense tool lives at. Plex Mono gives
true monospaced clarity for the terminal and diff, a slashed zero, and tabular figures for the
live metrics (counts, latencies, line numbers) that a multi-agent monitor is full of.

**Type scale** — rem on a 16px root, so it respects user zoom and OS text scaling (an
accessibility requirement), while rendering dense by default (base UI is 13px, not 16px). Ratio
is roughly a minor third, rounded to whole pixels for crisp rendering.

| Token | Size / line-height | Use |
|---|---|---|
| `2xs` | 11 / 16 | micro labels, badge text, table meta |
| `xs` | 12 / 16 | captions, dense table cells |
| `sm` | 13 / 18 | **base UI** — body, controls, lists |
| `base` | 14 / 20 | emphasized body, panel titles |
| `lg` | 16 / 22 | section headings |
| `xl` | 20 / 26 | view titles |
| `2xl` | 24 / 30 | page titles |
| `3xl` | 30 / 36 | brand / marketing only |

Weights: 400 body, 500 labels/controls, 600 titles. Tabular, slashed-zero figures are used
everywhere numbers are compared.

---

## 3. Color

Dark-first. The substrate is a near-black, faintly green-leaning neutral so that semantic color
reads as signal. Surfaces are layered by elevation; one brand accent (leaf green — the Grove
signature) carries selection, focus, and primary action. Light is a fully specified secondary
theme with the same role names.

### 3.1 Roles

- **Surfaces** (deepest → highest): `inset` (terminal/diff wells) · `base` (app) · `surface`
  (panels) · `raised` (cards, inputs, rows) · `overlay` (dialogs, popovers, toasts).
- **Text**: `fg` (primary) · `fg-muted` (secondary) · `fg-subtle` (tertiary, hint, disabled) ·
  `fg-on-accent`.
- **Lines**: `line-subtle` and `line` are decorative separators (exempt from contrast minimums);
  `line-strong` is the **form-control boundary** and meets 3:1 against its surface.
- **Accent**: leaf green — focus ring, selection, primary buttons, links.

### 3.2 State semantics (not random hues)

| Role | Meaning | Hue |
|---|---|---|
| `idle` | no agent running; worktree at rest | slate (neutral) |
| `running` | an agent is actively working | cyan |
| `attention` | agent paused / waiting on you | amber |
| `error` / diff **remove** | run failed / removed lines | red |
| `success` / `done` / diff **add** | ready to harvest / added lines | green (accent family) |
| `info` | informational, secondary links | blue |

Green doubles as *brand*, *success*, *done*, and *diff-add* on purpose: a completed worktree is
a matured shoot — the same idea the name encodes. Each state ships four tokens: a **solid**
(dots, fills, strong borders), an **fg** (text), a subtle **bg** tint (badges, rows), and a
**border** tint.

**State is never carried by color alone (WCAG 1.4.1).** It is triple-encoded: a color token, a
text label, and a shape/icon. `StatusBadge` shows icon + color + text and is the primary form;
the compact `AgentStatusDot` additionally distinguishes *idle* (hollow ring) and *running*
(pulse) by shape and always carries an accessible name.

### 3.3 Contrast — WCAG AA, enforced in CI

Every text pair clears **4.5:1** (normal text); every non-text signal — status dots, the focus
ring, the control boundary — clears **3:1** (SC 1.4.11). These are not claims in prose: all 52
documented pairs across both themes are asserted in `packages/ui/src/tokens.test.ts`, so a
regression that breaks AA fails `bun test`.

Representative ratios (dark theme, against `surface` unless noted):

| Pair | Ratio | Min |
|---|---|---|
| `fg` on surface | 15.1:1 | 4.5 |
| `fg-muted` on surface | 8.4:1 | 4.5 |
| `fg-subtle` on surface | 5.2:1 | 4.5 |
| `accent-fg` (link) on surface | 9.3:1 | 4.5 |
| `fg-on-accent` on accent fill | 7.5:1 | 4.5 |
| `running-fg` on surface | 10.4:1 | 4.5 |
| `attention-fg` on surface | 10.7:1 | 4.5 |
| `error-fg` on surface | 6.6:1 | 4.5 |
| `success-fg` on surface | 9.3:1 | 4.5 |
| `info-fg` on surface | 7.8:1 | 4.5 |
| `accent` focus ring on base | 7.4:1 | 3.0 |

Light theme holds the same bar (e.g. `fg` on surface 18.2:1, `fg-muted` 7.1:1, white on accent
fill 5.0:1, accent link 6.2:1).

---

## 4. Spacing, radii, elevation

- **Spacing** — a 4px base grid. Tailwind's numeric scale (1=4px, 2=8px, 3=12px, 4=16px, …) is
  adopted deliberately: it is a well-formed 4px system and matches Grove's dense rhythm. Most UI
  gaps are 4/8/12px. Exposed as `--space-*` for non-Tailwind CSS.
- **Radii** — engineered, not pillowy: `xs` 2 · `sm` 3 · `md` **5 (default — buttons, inputs,
  cards)** · `lg` 8 (panels, dialogs) · `xl` 12 (sheets) · `full` (dots, pills).
- **Elevation** — dark UI lifts with a lighter surface + a border + a soft shadow, not glow:
  `shadow-sm` (raised rows/inputs) · `shadow-md` (popovers, menus, toasts) · `shadow-lg`
  (dialogs, sheets).

---

## 5. Motion

Motion communicates **state change and spatial origin**; it is never ornament. Durations are
short because a dev tool must feel instant.

- Durations: `instant` 80ms (hover/focus/color) · `fast` 120ms (toggles, tooltips) · `base`
  180ms (popovers, menus, toast enter) · `slow` 240ms (dialogs, sheets).
- Easing: `standard` `cubic-bezier(0.2,0,0,1)` for enter/move (decelerate); `exit`
  `cubic-bezier(0.4,0,1,1)` for leave. **No spring or bounce.**
- The one looping animation is the `running` agent pulse — a slow ring that signals live work.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` collapses all transitions and
animations to near-instant and stops the running pulse and skeleton shimmer entirely. State
stays fully legible through color + glyph + label, so nothing is lost.

---

## 6. Accessibility stance

- **Dark-first, both themes AA**, verified by the contrast test; the app also honors
  `prefers-color-scheme` when no explicit choice is set.
- **Keyboard-first.** Every interactive element is reachable and operable by keyboard with a
  visible 2px accent **focus-visible** ring (offset from its surface). Tabs use roving tabindex
  with Arrow/Home/End; the dialog is the native `<dialog>` element (real focus trap, Escape,
  inert background); tooltips appear on focus as well as hover and dismiss on Escape.
- **Not color alone.** Status is triple-encoded (color + text + shape/icon).
- **Honest semantics.** Native `<select>`, real `<label>` association, `aria-invalid` +
  `aria-describedby` on fields, `role="status"`/`"alert"` live regions for toasts, `aria-busy`
  on loading buttons, required `aria-label` on icon-only buttons.
- **No label-by-hint.** Fields are always labelled; we do not use in-field ghost text as the
  only label (an accessibility anti-pattern). Helper text lives in a dedicated hint slot.
- **Touch.** On phone widths, controls grow to comfortable hit targets and navigation moves to a
  bottom bar; `env(safe-area-inset-*)` is respected.

---

## 7. Component library (`@swarm/ui/react`)

Hand-built on web platform primitives — no component-library defaults. Each ships its real
**empty / loading / error** states where applicable.

- **Actions** — `Button` (primary · secondary · ghost · danger; sm/md; loading; icon),
  `IconButton` (labelled, square).
- **Inputs** — `Input` (label, hint, error, leading icon), `Select` (styled native).
- **Containers** — `Panel` + `PanelHeader/Title/Body/Footer`, `Tabs` (accessible).
- **Status** — `Badge`, `StatusBadge`, `AgentStatusDot` (idle/running/attention/error/done).
- **Overlays** — `Tooltip`, `Dialog`, `Sheet` (edge-docked), `ToastProvider` + `useToast`.
- **Data** — `Table` family, `ListRow` (the dense, selectable workspace rail row).
- **Feedback** — `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`.
- **Surfaces** — `TerminalFrame` (tab strip, toolbar, status footer, recessed mono body) and
  `DiffView` + `CodeBlock` (change stats, gutter-aligned hunks, add/remove tints).
- **Theming** — `ThemeProvider`, `useTheme`, `ThemeToggle`.

All compile under strict TypeScript and pass Biome (including its accessibility rules).

---

## 8. Usage

```ts
// 1. Token contract anywhere (no React):
import { STATUS_META, contrastRatio, FONT_MONO } from "@swarm/ui";

// 2. Components in a renderer:
import { Button, TerminalFrame, ThemeProvider } from "@swarm/ui/react";
```

```css
/* 3. Variable layer + base, once at the app root: */
@import "@swarm/ui/tokens.css";
@import "@swarm/ui/styles.css";
```

```ts
// 4. Tailwind: spread the preset; theming is a data-theme swap, not a rebuild.
import { swarmPreset } from "@swarm/ui/tailwind-preset";
export default { content: [...], presets: [swarmPreset] };
```

Switch themes by setting `data-theme="dark" | "light"` on `<html>` (the `ThemeProvider` does
this and persists the choice). Tailwind utilities resolve to CSS variables, so one compiled
stylesheet serves both themes.

---

## 9. Running the showcase

```sh
bun install
bun run --filter @swarm/showcase dev      # http://localhost:5173  (live)
# or, against the production build:
bun run --filter @swarm/showcase build
bun run --filter @swarm/showcase preview
```

The showcase renders the tokens (type scale, palette, the enforced contrast grid, spacing,
radii, elevation, motion), every primitive with its empty/loading/error states, and the
composed Grove console at a desktop width and a 390px phone frame — with a live dark/light
toggle.
