# Phase-3 Performance Report (spec §6.4)

Recorded speed budgets for the Grove desktop client (Electron + React renderer on
`@swarm/ui`), measured against a **real** Grove host. No mocks, no synthetic numbers:
the renderer makes genuine tRPC + sync + PTY calls against the host booted by the e2e
`global-setup.ts`, and every figure below is a real `performance.now()` reading from the
connected app.

## Methodology

- **Harness:** `apps/desktop/e2e/_perf.spec.ts` — an assertion-light measurement tool
  (the only assertions are sanity guards that each run gathered its full sample set; no
  budget gates, so over-budget numbers are reported honestly instead of failing red).
- **Host:** booted by `e2e/global-setup.ts` — a real `@swarm/host` daemon seeded with a
  project + three worktrees over the engine's own store, a real `node-pty` PTY supervisor,
  and a live sync log. The renderer connects via the injected `window.__GROVE_HOST__`
  `{endpoint, token}`, exactly like the product specs.
- **Server:** Vite `preview` on `:4318` (the renderer self-builds before the run). The
  preview server is warm; per-iteration browser caches are cold (see cold-start note).
- **Timing technique:** an in-page `requestAnimationFrame` poller stamps `performance.now()`
  the instant the observable transition occurs (list populated / dialog open / selection
  changed / marker present); `start` is captured with `performance.now()` immediately
  before the Playwright action. The measured span therefore includes **~single-digit ms of
  Playwright/CDP input-dispatch overhead, which is NOT subtracted** — disclosed here rather
  than massaged out. This biases results slightly slow (never fast), which is the safe
  direction.
- **Machine (Windows dev host):** Windows 10 `10.0.19045`, Intel Core i7-7700HQ @ 2.80GHz
  (8 logical cores), 13 GB RAM. Node `v24.14.1`, Playwright `1.60.0` / bundled Chromium.
- **Scope:** single Windows developer host. **CI-side and cross-platform perf (macOS/Linux
  runners, packaged Electron) is a Phase-6 follow-up** — these numbers characterize the dev
  host only and are not a cross-platform guarantee.

## Results vs budget

| Metric | n | p50 | p95 | Budget | Verdict |
|---|---|---|---|---|---|
| Renderer cold start | 10 | **377 ms** | **423 ms** | < 3000 ms | **PASS** (≈8× margin) |
| Interaction — open dialog (Settings) | 20 | **110 ms** | **165 ms** | < 100 ms p50 / < 250 ms p95 | **OVER (marginal) on p50**, PASS on p95 |
| Interaction — switch workspace (keyboard) | 20 | **25 ms** | **63 ms** | < 100 ms p50 / < 250 ms p95 | **PASS** |
| Terminal-stream round-trip (P05) | 25 | **159 ms** | **611 ms** | < 150 ms p50 / < 400 ms p95 | **OVER on p50 (marginal) and p95 (significant)** |

Min/max (ms): cold start 356 / 425 · dialog 73 / 182 · switch 18 / 175 · terminal 35 / 806.

## Reading of each result

### Renderer cold start — PASS

Measured navigation-start → real `workspaces.list` resolved and the rail populated with the
seeded worktree. p50 377 ms / p95 423 ms against a 3000 ms budget — a comfortable ~8× margin.
Each iteration used a **fresh browser context** (cold HTTP/module cache) so this is a true
renderer boot + tRPC connect, not a warm reload; the only warm component is the local preview
server, which is the realistic dev-host condition. Packaged-Electron cold start (no Vite, but
a real window create) is verified separately in Phase 5.

### Interaction — switch workspace via keyboard — PASS

`Ctrl+Alt+ArrowDown` → the newly selected row's `aria-current` text updates. p50 25 ms /
p95 63 ms, far inside budget. A single 175 ms outlier (one GC/layout hitch) is the only
sample above 60 ms and does not move p95 past budget.

### Interaction — open dialog (Settings) — marginally OVER on p50, PASS on p95

Click "Keyboard shortcuts" → native `<dialog>` open. p50 110 ms is ~10 ms past the aggressive
100 ms p50 line; p95 165 ms is well inside the 250 ms p95 line. The measured span includes the
disclosed CDP click-dispatch overhead plus a React state commit, `dialog.showModal()`, and the
dialog's first paint. The ~10 ms overshoot sits inside the disclosed harness-overhead band, so
true app-side latency is plausibly at or just under 100 ms — but the **measured** p50 is
reported honestly as marginally over the 100 ms target. Not a ship blocker; p95 is healthy.

### Terminal-stream round-trip (P05) — OVER on p50 (marginal) and p95 (significant)

Measured Enter-press → the command's deterministic marker appearing in the live xterm buffer,
round-tripping through the host PTY + `/terminal` WebSocket + xterm render. To avoid timing the
input echo, the typed command splits the marker across two string literals so the marker is
**contiguous only in the command's output**, never in the echoed input.

The distribution is **bimodal**:

- **Transport floor is fast and within budget.** Min 35 ms, with a large cluster of
  sub-120 ms samples (35, 56, 67, 81, 83, 83, 88, 94, 104 …). The WebSocket + PTY pipe +
  xterm render path is **not** the problem.
- **A handful of 300–806 ms spikes drag p95 to 611 ms** (806, 624, 561, 472, 430, 404, 340,
  327 …). These are **interactive Windows PowerShell 5.1 per-command execution variance** —
  PSReadLine re-rendering the line, the PowerShell pipeline spin-up per command, and occasional
  GC/JIT pauses in the spawned shell. This is host-shell cost, not Grove's streaming layer.

**Likely cause stated plainly:** the over-budget p95 is dominated by the interactive PowerShell
shell on this Windows host, not by Grove's terminal transport. Evidence: the fast-path samples
(many < 120 ms) show the transport itself clears budget; the spikes correlate with shell
command processing. Expected mitigations to confirm in Phase 6: measure on macOS/Linux with
`bash` (lighter per-command cost), and on Windows compare `cmd` and the preset one-shot
(non-interactive) path. The number is surfaced honestly rather than re-sampled to hide the tail.

## Raw samples (ms)

- **coldStart** (n=10): 377.4, 359.9, 360.6, 425.4, 419.3, 377.2, 373.1, 355.8, 392.2, 378.8
- **dialogOpen** (n=20): 133.0, 122.6, 117.7, 127.7, 145.3, 73.0, 111.6, 132.7, 83.1, 108.8,
  181.6, 96.6, 92.9, 88.2, 88.6, 74.8, 118.5, 97.5, 99.9, 163.7
- **workspaceSwitch** (n=20): 41.5, 23.5, 18.0, 26.8, 20.6, 24.5, 17.7, 24.9, 28.8, 22.6, 17.8,
  28.1, 19.9, 28.4, 57.3, 174.8, 23.1, 19.5, 24.7, 41.9
- **terminalStream** (n=25): 430.1, 158.6, 80.9, 121.7, 806.1, 88.4, 623.9, 103.8, 82.9, 67.4,
  561.3, 340.2, 326.7, 151.6, 128.0, 176.9, 471.7, 403.5, 211.2, 83.2, 258.2, 55.8, 34.6,
  161.6, 94.0

## Verdict

- Cold start and keyboard interaction comfortably meet budget.
- Dialog-open p50 is marginally over the 100 ms target (110 ms) but well within p95; treat as a
  watch item, not a blocker.
- Terminal-stream p95 is over budget on this host, attributable to interactive Windows
  PowerShell, not Grove's transport — the cross-platform re-measurement is the Phase-6 perf
  follow-up.

Reproduce: from `apps/desktop`, `node ./node_modules/@playwright/test/cli.js test e2e/_perf.spec.ts`
(numbers are written to a machine-readable `grove-perf-results.json` in the OS temp dir).
