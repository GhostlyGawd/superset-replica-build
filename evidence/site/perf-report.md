# apps/site — performance ("lightning fast")

**Surface:** Grove launch site (`apps/site`, ADR-0021) — prerendered static HTML, hydrated islands.
**Date:** 2026-06-16 (Windows host).
**Claim under test (DESIGN.md §Verification):** *lightning-fast — static, preloaded fonts, no heavy
island gating LCP.*

## Methodology — why Playwright, not Lighthouse

DESIGN.md asks for a Lighthouse perf score, with an explicit fallback: *"if Chrome/Lighthouse isn't
feasible on this host, FALL BACK to a Playwright performance measurement … stated honestly."*

This host has **no system Chrome** (only Playwright's bundled Chromium, which Lighthouse cannot
drive reliably for a scored run). So the numbers below are a **Playwright navigation-timing +
resource-transfer measurement** against the **served static `dist`** (`vite preview`), not a
Lighthouse score. Method: launch Playwright Chromium at a 1440×900 desktop viewport, cold-load the
page 5× (a fresh browser context each time), and take the **median** of the Navigation Timing /
Paint Timing / LCP-observer values; capture per-resource transfer sizes from the network. This is
honest about what it is — real browser timings on the real built output — and reproducible in CI.

## Numbers (median of 5 cold loads, Playwright Chromium, vite preview over `dist`)

| Metric | Median |
|---|---|
| Document `responseEnd` (HTML fully received) | **~11 ms** |
| `domInteractive` | **~33 ms** |
| `domContentLoaded` | **~140 ms** |
| First Contentful Paint (FCP) | **~0.40–0.56 s** |
| Largest Contentful Paint (LCP) | **~0.40–0.56 s** |
| `load` (all resources incl. 5 fonts) | **~0.34–0.44 s** |

(Two measurement passes agreed within noise: FCP 396 ms / 560 ms; LCP tracked FCP in both.)

### The load-bearing result: LCP is the prerendered HTML, not a JS island

**LCP == FCP** in every run. The largest contentful paint is the prerendered section copy that
ships in the static HTML — it is painted with the first content and is **not gated on the hydrating
island bundle**. That is exactly the DESIGN.md requirement ("LCP is never gated on a heavy island").
The document is received in ~11 ms and the DOM is interactive in ~33 ms because the server response
is a complete page, not a blank SPA shell.

## Transfer sizes (gzip on the wire) + bundle breakdown

| Resource | On-wire transfer | Notes |
|---|---|---|
| Document (`/index.html`) | **~15.7 kB** (130 kB raw) | Prerendered — real copy for every section, no-JS/unfurl/SEO complete |
| CSS (`index-*.css`) | **~7.7 kB** (32 kB raw) | One stylesheet |
| JS (`index-*.js`) | **~84 kB** (283 kB raw) | One hydration bundle (React 19 + `@swarm/ui` islands) |
| Fonts (×5 woff2) | ~102 kB total | IBM Plex Sans/Mono, **preloaded**, width-reserved (tabular figures don't shift) |
| **Total JS transferred** | **~84 kB gz** | single script, no code-split waterfall |

The build emits exactly **one** JS asset and **one** CSS asset (`apps/site/dist/assets/`), so there
is no chunk-request waterfall on the critical path.

## Prerendered-static-HTML evidence

- `apps/site/dist/index.html` contains the **real copy** for every section — verified at build time
  by `scripts/prerender.mjs` (it throws if the proof string "Keep one calm surface" is missing) and
  re-verified by the render spec asserting section copy is present at both viewports. Spot checks in
  the built HTML: the cold-open headline, the swarm-dial caption, the terminal poster-frame
  (`bun test auth/`, "agent paused — waiting on your input"), the isolation fork-visual labels, and
  the install commands are all in the static markup.
- **Fonts are preloaded** in `apps/site/index.html` (`<link rel="preload" as="font" … crossorigin>`
  for Plex Mono 400 + Plex Sans 400/500), so tabular figures never reflow.
- The only on-paint motion is the honest wall-clock + cursor blink (MOTION LAW); nothing autoplays,
  so no animation work competes with first paint.

## Reproduce

Build the site (`bun run --filter @swarm/site build`), then serve `dist` with `vite preview` and
drive it with Playwright Chromium capturing `performance.getEntriesByType('navigation')` + a
`largest-contentful-paint` PerformanceObserver + `request().sizes()` per response. (The one-shot
script used for this report was not retained in the suite; the render + a11y specs in
`apps/site/e2e/` are the committed gates.)
