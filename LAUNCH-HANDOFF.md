# LAUNCH-HANDOFF — continue the loop: green CI + host on GitHub Pages

**For a fresh chat.** RE-DERIVE FROM THE BLACKBOARD, not chat history: this file +
`STATE.json` + `DECISIONS.md` (ADR-0020/0021) + `apps/site/DESIGN.md` + `evidence/site/review.md`
+ `.github/workflows/ci.yml`. Operate as the autonomous Orchestrator (same non-negotiables as the
whole build — see "Laws" below).

## Where things are (done)
- **Product:** Grove v1.0.0 shipped (all 14 parity items). Repo **renamed `github.com/GhostlyGawd/grove`**.
- **De-positioned** off "Superset replica" on every shipped surface (ADR-0020); only internal
  provenance (`DECISIONS.md`, `docs/recon.md`, `evidence/**`) still references it, by design.
- **Landing page `apps/site`** — BUILT + VERIFIED at code commit **`98b44b2`**: Vite + React +
  `@swarm/ui`, prerendered to static HTML (`react-dom/server renderToString` + `scripts/prerender.mjs`).
  The page IS the Grove cockpit (pinned shell + 8 sections + the **SWARM DIAL** signature +
  cross-surface harvest + per-tab terminal + OS-aware install). Independent **§6.3 Critic ALL-PASS**
  (`evidence/site/review.md`); **axe 0 critical/0 serious**; prerendered-static (LCP==FCP ~0.4–0.56s,
  84 kB gz JS); nothing autoplays; one leaf-green accent. Spec: `apps/site/DESIGN.md`.
- The page's CI is wired: a **`site` job** (ubuntu render + axe) + the `verify` matrix builds
  `apps/site` 3-OS. The code at `98b44b2` was **3-OS CI green** (run 27639550916, all 9 jobs).

## THE LOOP'S REMAINING GOALS (it is complete only when BOTH are true)

### Goal 1 — CI is GREEN on HEAD (currently RED — a flake)
The latest commit **`af7fefd`** (docs-only: STATE.json + DECISIONS.md) hit a **RED** CI run
**27639883568**: `verify (windows-latest) → Typecheck` failed. **This is a Windows-parallelism
FLAKE, not a real defect** — the same code passed Windows typecheck at `98b44b2` and passed
macOS+ubuntu in the same run; `af7fefd` changed no code; tsc **exited in ~0.5s with no `error TS…`**
(a crash/spawn failure under turbo's 18-way parallel `tsc`, the documented **ADR-0011 Windows
file-lock/contention class**).
- A **re-run of the failed job was already triggered** (`gh run rerun 27639883568 --failed`).
  **First action: confirm it went green** (`gh run view 27639883568 --json conclusion,jobs`). If green,
  Goal 1 is met for now.
- **If the Windows typecheck flake RECURS** on any later push (it may, during the Pages work),
  make it **durable**: cap turbo typecheck concurrency on Windows the way the test step already is
  (`bun run test` = `turbo run test --concurrency=2`) — e.g. change the root `typecheck` script (or
  the CI step) to `turbo run typecheck --concurrency=2`, OR add a bounded retry to the CI Typecheck
  step. Record it as an ADR + gate (clean-install) + confirm 3-OS green. (Don't mask a real error —
  verify there is no `error TS` first; there isn't here.)

### Goal 2 — the site is LIVE on GitHub Pages and verified
GitHub Pages is **NOT enabled** yet (`gh api repos/GhostlyGawd/grove/pages` → 404). Stand it up:
1. **Decide the base path + record an ADR (ADR-0022).** Project Pages serve at
   **`https://ghostlygawd.github.io/grove/`** (a `/grove/` subpath), so Vite must build with
   **`base: '/grove/'`** or every asset 404s. (Alternative: a custom domain e.g. `grove.dev` → base
   `/` + a `CNAME` file + DNS — only if the user owns the domain; default to the subpath, it needs no
   purchase.) Make the base configurable so a later custom domain is a one-line change.
2. **Set `base` in `apps/site/vite.config.*`** (both the client + SSR builds) and make
   `scripts/prerender.mjs` + the prerendered HTML respect it. Re-verify **every asset loads under the
   base**: the vendored fonts (`public/fonts/*` + the `<link rel=preload>` paths), JS/CSS, favicon,
   and the **OG image** (`og:image` must be an ABSOLUTE URL — `https://ghostlygawd.github.io/grove/og-cockpit.png`
   — for social unfurls). Add a `.nojekyll` file to `dist` (so Pages doesn't strip `_`-prefixed assets).
3. **Add a Pages deploy workflow** `.github/workflows/pages.yml` (separate from `ci.yml`): on push to
   `main` (after CI, or gated on it) → checkout → bun + node 24 → `bun install --frozen-lockfile` →
   `bun run --filter @swarm/site build` → `actions/upload-pages-artifact@v3` (path
   `apps/site/dist`) → `actions/deploy-pages@v4`. Needs `permissions: { contents: read, pages: write,
   id-token: write }`, `environment: github-pages`, `concurrency: { group: pages }`. The first deploy
   auto-enables Pages (build_type=workflow), or enable explicitly:
   `gh api -X POST repos/GhostlyGawd/grove/pages -f build_type=workflow`.
4. **Verify the LIVE site** (not just the build): after deploy, fetch the real URL and confirm it
   renders — `curl -sI https://ghostlygawd.github.io/grove/` 200 + the HTML has the real cockpit copy
   + assets resolve (no 404s in a Playwright run against the live URL; the SWARM DIAL + sections work).
   Persist proof to `evidence/site/deploy.md` (the live URL + a Playwright screenshot of the deployed
   page).
5. **Make the install section honest for launch.** In `apps/site/src/sections/Install.tsx`: the
   **source path is real** (`git clone https://github.com/GhostlyGawd/grove && cd grove && grove up`)
   — keep it. `brew install grove` / `winget install grove` / `grove.dev` are **not real yet** — either
   keep them clearly labeled as pending release channels (current state) or, if the user sets up a
   `grove.dev` domain / Homebrew tap / winget manifest, wire the real ones. Update any repo links to
   `github.com/GhostlyGawd/grove` and the docs/PWA links. Do NOT fabricate working package managers.
6. **Re-verify** the page after the base-path + install changes (gate green, axe still 0/0, the
   independent §6.3 Critic re-checks if the change is non-trivial), 3-OS CI green, then deploy.

## Laws (carry over — non-negotiable)
Working product, no mocks on user paths · zero human input (record decisions in `DECISIONS.md`,
never ask) · delegate to subagent waves + persist to files (subagents return ≤40 lines + paths) ·
no banned tokens · `@swarm/ui` for UI · operator voice (no exclamation marks; banned words
revolutionary/magical/effortless/10x/blazingly/unleash/seamless/supercharge) · **MOTION LAW**
(nothing autoplays; pull-only reveals; reduced-motion) · OSS-only · **Windows-first proven by green
windows+macos+ubuntu CI** · independent Critic gate (did NOT build it) for any non-trivial UI change ·
`harness predict` before non-trivial work + score open predictions · gate every pushed HEAD with a
clean install + confirm the 3-OS CI run.

## Done bar (when to STOP the loop)
(1) CI is **GREEN on HEAD** (all jobs incl `verify (windows-latest)` and the `site` job); the
Windows typecheck flake is either confirmed-transient (re-run green) or durably fixed. (2) The site
is **LIVE** at the GitHub Pages URL and an independent check confirms it renders correctly (assets
load at the base path, cockpit + dial + sections work, OG card resolves). (3) Install commands +
links are real or honestly labeled. (4) Decisions recorded (ADR-0022 deploy); `STATE.json`
finalized; open prediction scored. Then surface the live URL to the user and STOP.

## Key pointers
- `STATE.json` (`phase_status` + `next_actions`), `DECISIONS.md` (ADR-0020 de-position, ADR-0021
  site, append ADR-0022 deploy), `apps/site/DESIGN.md` (the build spec + laws), `evidence/site/`
  (review.md = §6.3 Critic ALL-PASS, a11y.md, perf-report.md, screenshots), `.github/workflows/ci.yml`
  (jobs: verify ×3, e2e desktop, e2e mobile, `site`, package ×3), `apps/site/` (Vite app;
  `scripts/prerender.mjs`; `e2e/` Playwright render+a11y; `package.json` build = client + ssr +
  prerender). Harness CLI for predictions lives in the recursive-harness repo (`python bin/harness …`,
  relative path, NO shell redirects — the guard blocks redirect+`bin/`).
