# Phase 1 — Showcase Visual Evidence

Full-page Playwright screenshots of `apps/showcase` (Grove design system gallery),
captured from the production preview build (`vite preview`, HTTP 200 on `:4317`).

The showcase is a single scrolling page covering all sections — Foundations
(color tokens, type scale), Primitives (buttons, badges, inputs, selects, tabs,
table, spinners/skeletons, empty + error states, dialog, toast), Surfaces
(panels/cards), and Console (terminal frame, diff view) — so one shot per
viewport/theme captures the whole gallery.

Theme is driven by `data-theme` on `<html>` + `localStorage["grove-theme"]`
(read by `@swarm/ui` `ThemeProvider`, default dark). Each shot seeded the theme
via an init script before first render.

| File | Viewport (logical) | Theme | Notes |
|------|--------------------|-------|-------|
| `desktop-dark.png`  | 1440×900 (DSF 1)  | dark  | Full gallery, dark-first primary theme. |
| `desktop-light.png` | 1440×900 (DSF 1)  | light | Full gallery, light theme. |
| `phone-dark.png`    | 390×844 (DSF 2)   | dark  | Mobile layout; top nav collapses, single-column stack. PNG is 780×21282 (2× scale). |
| `phone-light.png`   | 390×844 (DSF 2)   | light | Mobile layout, light theme. PNG is 780×21282 (2× scale). |

## Capture method

- Build: `bun run --filter @swarm/showcase build` (green, built in ~1s).
- Browser: `bunx playwright@latest install chromium` (Chromium 1223) — transient,
  no repo deps added (package.json / bun.lock untouched).
- Preview server: `bun run --filter @swarm/showcase preview -- --port 4317 --strictPort`,
  polled until HTTP 200, killed after capture.
- Driver: `_shots.mjs` (sibling dir) — throwaway evidence tooling. Playwright was
  installed into an isolated temp dir (`%TEMP%/grove-pw-shots`) so the repo's
  dependency manifests stayed clean; the script resolves it via `PW_HOME`.

### Runtime note

`chromium.launch()` hangs under **Bun** on this Windows host (Playwright's
`--remote-debugging-pipe` transport timed out: `TimeoutError: launch: Timeout
180000ms exceeded`). Running the identical script under **node 24** launched
Chromium and captured all four shots successfully. Evidence tooling that drives
Playwright on this host should use `node`, not `bun`.

## Observations

- No clipping or broken layout at phone width (390px): content width tracks the
  viewport, code/terminal blocks scroll inside their own containers rather than
  overflowing the page. Desktop nav (`hidden md:flex`) correctly collapses on phone.
- Contrast holds in both themes; dark is the dense, intended-primary look.
- The open Dialog / dropdown overlays pinned near the top of every shot are the
  showcase deliberately demonstrating overlay components in their open state
  (present at both viewports) — not a rendering defect.
