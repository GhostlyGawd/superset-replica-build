# Grove launch site — build spec (apps/site)

Synthesized by the multi-agent design Workflow (4 directions → adversarial judge panel →
synthesis). **Build this verbatim.** Tech per ADR-0021: Vite + React + `@swarm/ui`, prerendered
to static HTML, interactive demos as hydrated islands. The page must read as a glass cockpit a
buyer would want to acquire — never a generic marketing page.

## Concept
The landing page is **a working instance of the Grove mission-control shell, not a page about
it.** A persistent cockpit frame — top STATUS RAIL, left WORKSPACE RAIL, bottom STATUS STRIP — is
pinned for the entire scroll; documentary sections load into the center CONTENT WELL like panes,
so the chrome never leaves the screen and scrolling reads as *operating a console*. Spine =
pinned-shell + cross-surface cause-effect (the most credible "this is the real product" proof);
signature = the **SWARM DIAL** (crank 1→100+ agents by hand, the ordered surface refuses to
flinch — the thesis *enacted, not asserted*).

**Tagline (the page's ONE 30px line):** "Run a swarm of coding agents. Keep one calm surface."

## MOTION LAW (the panel's most-repeated dock — non-negotiable)
**The page is STILL until the visitor acts. NOTHING autoplays** — no scroll-into-view triggers,
no on-load loops, no streaming-on-paint. Every reveal is a PULL (keystroke, drag, click, replay
button). The only unprompted on-screen change is **honest wall-clock timers** (a ticking number,
not an animation) and the terminal **cursor blink** at rest. Easing is restrained ease-out /
180ms product-status; **no bounce, no spring, no parallax.** Full `prefers-reduced-motion`:
pulses freeze to static filled dots, replays jump to end state, counts place instantly.

## BRAND NOTES (build guardrails)
- **Color:** one near-black green-leaning substrate; `#3fb950` leaf-green is the ONLY accent —
  confined to focus ring, selection, the single primary Button at a time (install CTA / Harvest),
  and links. State semantics strictly **triple-encoded (color + word + dot shape)**, never
  color-alone: idle=slate (hollow ring) · running=cyan (pulse) · attention=amber · error/diff-remove=red ·
  done/diff-add=green · info=blue.
- **TOKEN COLLISION TO FIX:** brand-accent green and "done" status green are the same family —
  keep them DISTINCT in token values OR ensure context disambiguates (focus ring = 1px outline;
  done dot = filled shape) so a completed agent never reads as a focus signal. Use the existing
  `@swarm/ui` tokens (`accent` vs `success`/`done`) — verify they're visually separable.
- **Type:** IBM Plex Sans (UI) + IBM Plex Mono (terminal/diff/code/ALL figures) via Fontsource,
  **preloaded**, width reserved so tabular figures never shift layout. Base UI 13px, dense. The
  30px `3xl` appears **exactly once** (the section-00 headline). All numbers use **tabular,
  slashed-zero** figures.
- **Contrast (pin it, don't assert):** body/comment mono text ≥ 4.5:1 on the near-black
  substrate (no dim "comment gray" below this for value-prop copy); non-text UI (dots, borders,
  focus ring) ≥ 3:1; `#3fb950` on near-black clears for accent uses. Enforce with the `@swarm/ui`
  tokens (already AA-tested).
- **Surfaces:** square-ish, hairline 1px borders, minimal radii, **zero blur, zero drop-shadow,
  zero glassmorphism.** Dark-first; `ThemeToggle` present but dark is home.
- **Mark:** trunk forking into three shoots tipped with filled nodes; the three nodes ARE the
  product `AgentStatusDot` and animate in the shell ONLY after first user interaction.

## Architecture
- **SSR / prerender:** every section ships **real copy in the static HTML** (good unfurl / SEO /
  no-JS). Interactive islands hydrate over that real content. LCP is never gated on a heavy island.
- **Shared "cockpit store"** (lightweight Zustand or Context): single source of truth across all
  islands — the rails subscribe to it; section demos dispatch to it; this is what makes the
  **cross-surface cause-effect** real (harvest a diff → the rail row flips done; tap the phone →
  the desktop rail updates).
- **One shared rAF clock** drives all elapsed timers (NOT N setIntervals).

## Persistent shell (always on screen)
- **TOP STATUS RAIL (40px):** left = trunk-fork mark (16px, nodes are real `AgentStatusDot`) +
  `grove` wordmark (Plex Mono) + `v1.0.0`; center = live swarm tally in tabular figures
  (`14 agents · 9 running · 3 attention · 2 idle`); right = host pill `loopback:7433 · paired` +
  Cmd-K hint + `ThemeToggle`.
- **LEFT WORKSPACE RAIL (220px):** `ListRow` per worktree, leading `AgentStatusDot` + mono branch.
- **CENTER CONTENT WELL:** where panes scroll through.
- **BOTTOM STATUS STRIP (28px):** `grove · loopback:7433 · bearer · embedded postgres · 0 outbound`
  + swarm clock (tabular, ticking) + a down-chevron scroll affordance.
- Rails/strip are **sticky over native document flow** (NOT an inner scroll container).
- **Command palette** (Dialog island, ⌘K / `/`): real product verbs `up · ls · diff · status ·
  harvest · pair · kill` as keyboard nav that scrolls/focuses the matching pane.

## Sections (in order) — each: purpose · layout · copy · demo(what/how/components) · motion
> Full per-section detail is in the Workflow result; the builder implements each faithfully.

1. **00 · Cold open — live roster.** The one 30px headline + 13px operator subhead + inline
   `grove up` (primary) / `Read the docs` (ghost); then a dense AGENT ROSTER `Table` (STATUS ·
   AGENT · WORKTREE · RUN · Δ · ELAPSED). Renders SSR from a fixed fixture (real text in HTML).
   After hydration ONLY per-row elapsed timers advance (one shared rAF). Hover → `Tooltip` worktree
   path; click row → left rail highlights the branch (teaches agent↔worktree pinning); a `Select`
   "sort by attention". Components: Table, ListRow, AgentStatusDot, StatusBadge, Tooltip, Select, Button.
2. **01 · The Swarm Dial (signature).** A mono STEPPER `AGENTS` over a worktree GRID; pinned tally
   + caption recompute from the same number. Drag/arrow 1→100+ populates the grid, each agent
   pinned to `.grove/wt/agent-N`; geometry/cadence/palette/order hold steady (the reward is what
   did NOT break). Steadiness made TRUE: fixed-geometry grid (canvas or virtualized DOM +
   `content-visibility`) so no reflow/dropped frames at N=100+; dot pulses are CSS keyframes
   (transform/opacity), OFF until first dial move; cells ease in 80ms one row at a time; caption
   counts in tabular figures. Reduced-motion: static dots, instant placement.
3. **02 · Worktree isolation.** Split `Panel`: left = N worktrees forking off one trunk (brand
   mark as a fork); right = `CodeBlock` of the real `.git/worktrees/<agent>` layout. Text-labeled
   segmented toggle `per-worktree (Grove)` / `shared checkout` swaps two prerendered `DiffView`
   fixtures + flips a `StatusBadge` `isolated`(green)→`collision risk`(amber) — the failure mode
   Grove removes. State-change on click only.
4. **03 · The terminal.** `TerminalFrame` filling the well with a working `Tabs` strip
   (per-agent shells) + one split. SSR poster-frame of the final state. Replay is **pull-only**
   (▶ click or `up` from palette), plays once, holds; honest `recorded session` badge. ANSI mapped
   to the Grove semantic palette. Cursor blink (CSS) is the only ambient motion.
5. **04 · Diff review & harvest (cross-surface proof).** `DiffView` island (split/unified),
   +green/−red gutters + `Badge` count; right `Panel` summarizes the run like a commit. Click a
   line to amend (constrained single-line contenteditable, honest — not Monaco); `Harvest → main`
   dispatches a store action → that agent's row in the **pinned rail flips done-green** (single
   180ms status ease) + the status strip prints `harvested … → main · worktree retired`.
   **Harvest is scoped to ONE reviewed worktree per click — never animates a fleet auto-merging.**
   Amber/conflict agents stay amber. Components: DiffView, Panel, Button, IconButton, Badge, Tabs, Toast.
6. **05 · Monitoring & attention.** A `StatusBadge` legend (every state: color + word + shape) +
   tabular counts strip + a notifications `ListRow` stack. A labeled `simulate a notification`
   IconButton fires ONE restrained `Toast` (pull, never push); clicking it focuses that worktree.
   `Select` regroups by host/repo/status. Board reads from the SAME store (one truth).
7. **06 · Phone pairing.** A QR `Panel` (clearly a **labeled sample**, not a fabricated code)
   with loopback/bearer caption, beside a to-scale phone frame (`Sheet`/device frame) running the
   real mobile `BottomNav` layout (Swarm/Terminal/Diff). `pair` click flips the phone from a
   locked `EmptyState` to the live cockpit bound to the SAME store; tapping the phone updates the
   desktop rail (cross-surface proof). Forward-faked pairing, honestly labeled. No real network.
8. **07 · Install (CTA).** OS-detected `CodeBlock` + copy `IconButton`; `Tabs` (macOS/Linux/Windows)
   auto-selected from `navigator` at hydration (SSR default macOS so no-JS still valid). Signed-
   installer download `ListRow`s per OS (sizes as **labeled-honest samples** until release
   numbers exist) + a `git clone` row + three cost `Badge`s (`self-hosted` · `OSS · MIT` ·
   `embedded Postgres (PGlite) · no service to run`). Closing mono line: `grove up — loopback,
   bearer-gated, embedded Postgres. Nothing leaves your machine.` Down-chevron becomes
   `return to top`.

### Install commands (consistent with `grove up`)
- macOS: `brew install grove` then `grove up`
- Linux: `curl -fsSL https://grove.dev/install.sh | sh` then `grove up`
- Windows: `winget install grove` then `grove up`
- Source: `git clone https://github.com/GhostlyGawd/grove && cd grove && grove up`
- Note plainly: self-hosted, OSS (MIT), embedded Postgres (PGlite — no DB to run), loopback +
  bearer by default (nothing phones home). Phone PWA pairs from the running desktop via in-app QR.
  _(Install URLs/managers are launch markers, labeled as such until the release channels exist.)_

## Meta / OG
- Title: `Grove — mission control for a swarm of CLI coding agents`.
- Description (<160, operator voice): `Run Claude Code, Codex, Cursor — any CLI agent — in
  parallel, each pinned to its own git worktree so they never collide. Watch, review, harvest.
  Self-hosted, loopback by default. grove up.`
- OG card = a **static true-to-product capture of the cockpit at rest** (dark substrate, pinned
  status rail with the tally, worktree rail, a slice of the roster, trunk-fork mark top-left). NO
  gradient, NO centered slogan over a void — the social preview IS a screenshot of the console.
  `summary_large_image`.

## Anti-generic guardrails (why this is NOT the generic route — enforce all five)
1. **No centered hero** — structurally impossible: the top of the page is the product's real
   pinned chrome; the one 30px line lives inline inside it.
2. **Not a passenger narration** — you operate a pinned shell; the SWARM DIAL is cranked by the
   visitor. Thesis enacted, not animated at them. (⇒ the autoplay ban.)
3. **Not a fake-terminal costume** — diff/monitoring/phone render as the REAL graphical surfaces,
   all SSR'd as real copy (crawlers/unfurls/no-JS get the full page).
4. **Not stock/default-AI** — bespoke cockpit panels from `@swarm/ui`, 13px Plex, tabular
   slashed-zero figures, hairline borders, zero blur/shadow/glass, one substrate, one accent,
   color strictly as triple-encoded status. No purple/indigo, gradient, emoji, rounded-friendly-SaaS.
5. **Honest, not hype** — harvest constrained to truth (stages one reviewed worktree, leaves amber
   amber, never auto-merges a fleet); terminal labeled `recorded session`; QR a labeled
   sample; operator voice, zero banned words, zero exclamation marks, cost stated plainly.

## Verification (the loop is complete only when ALL pass)
build/typecheck/Biome/banned-token green · **Lighthouse** perf + a11y (lightning-fast: static,
preloaded fonts, no heavy island gating LCP) · **axe** 0 critical/serious · Playwright screenshots
(desktop + phone) it actually renders · brand-token fidelity (no off-palette hue, none of the
forbidden defaults) · an **independent §6.3 anti-slop Critic** (did NOT build it) · **green 3-OS
CI** with `apps/site` added to the build.
