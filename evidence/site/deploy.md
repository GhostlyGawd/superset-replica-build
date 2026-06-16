# apps/site — GitHub Pages deploy proof (ADR-0022)

**Live URL:** https://ghostlygawd.github.io/grove/
**Date:** 2026-06-16 · **Status:** LIVE + independently verified.

## What shipped
The verified launch site (ADR-0021) is now HOSTED on GitHub Pages at the `/grove/`
project subpath. Code commit `ce71b64`. Pages source = GitHub Actions (`build_type=workflow`),
HTTPS enforced.

- **Vite `base: '/grove/'`** (env `SITE_BASE`) — Vite auto-rebases the bundled JS/CSS, the
  `index.html` font preloads, the `@font-face url()` in the bundled CSS, and the `og:image`
  meta to the subpath.
- **`scripts/prerender.mjs`** absolutizes `og:image`/`twitter:image` to
  `https://ghostlygawd.github.io/grove/og-cockpit.png`, injects an absolute `<link rel=canonical>`
  + `og:url`, and writes `dist/.nojekyll`.
- **`.github/workflows/pages.yml`** — gated on a GREEN `CI` completion on `main` (`workflow_run`,
  `conclusion == 'success'`) + manual dispatch; `upload-pages-artifact@v3` (`apps/site/dist`) →
  `deploy-pages@v4`; a base-correctness guard runs before upload.

## CI gate + deploy runs
- **CI (gate):** run `27643073870` — GREEN, all 9 jobs (verify ×3 incl `windows-latest`,
  e2e desktop + mobile, the `site` render/a11y job now driving the `/grove/` artifact, package ×3).
- **Pages deploy:** run `27643295363` — `build` ✓ + `deploy` ✓ (auto-fired via the CI `workflow_run` gate).

## Live verification (the REAL URL, not the build)
`curl` against `https://ghostlygawd.github.io/grove/`:

| Check | Result |
|---|---|
| root `/grove/` | `200`, `text/html` |
| prerendered copy | "Run a swarm of coding agents. Keep one calm surface.", "The swarm dial", "Install Grove" all present |
| `og:image` | `https://ghostlygawd.github.io/grove/og-cockpit.png` (absolute) |

Every asset resolves `200` under the base (no 404s):

| Asset | Status | Type | Size |
|---|---|---|---|
| `/grove/assets/index-Cnpzddet.js` | 200 | application/javascript | 282,990 b |
| `/grove/assets/index-Dd6wjn6Z.css` | 200 | text/css | 32,314 b |
| `/grove/fonts/ibm-plex-mono-latin-400-normal.woff2` | 200 | font/woff2 | 14,708 b |
| `/grove/fonts/ibm-plex-sans-latin-400-normal.woff2` | 200 | font/woff2 | 22,588 b |
| `/grove/fonts/ibm-plex-sans-latin-500-normal.woff2` | 200 | font/woff2 | 24,184 b |
| `/grove/og-cockpit.png` (the social card) | 200 | image/png | 86,435 b |

**Live Playwright smoke** (`apps/site/scripts/verify-live.mjs`, headless Chromium vs the live URL):
- Page rendered; the headline + sections present.
- **Hydration proven live:** cranked the SWARM DIAL to 64 → caption recomputed to
  "64 agents · 64 worktrees"; the command palette island opened.
- **0 bad responses (>=400), 0 failed requests** — every asset loaded under `/grove/`.
- Full-page screenshot: `evidence/site/deploy-live.png` (the complete cockpit — roster, dial
  grid, isolation/terminal/harvest/monitoring, phone QR, install tabs; fonts loaded; one
  leaf-green accent).

## Install honesty (unchanged, already honest)
`apps/site/src/sections/Install.tsx` ships the REAL source path
(`git clone github.com/GhostlyGawd/grove && cd grove && grove up`) and labels `brew`/`winget`/
`grove.dev` as launch markers ("Install URLs and package managers are launch markers, named
here ahead of the release channels going live"). No fabricated package managers (ADR-0020).

## Re-deploy
Any future green push to `main` auto-redeploys via the `workflow_run` gate. A custom domain
later is a one-line change: `SITE_BASE=/ SITE_URL=https://grove.dev/` + a `CNAME`.
