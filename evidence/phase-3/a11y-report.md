# Phase-3 Accessibility Report (spec §6.2)

Automated `axe-core` audit plus a keyboard-navigation pass for the Grove desktop client,
run against the **real**, connected renderer (real host: tRPC + sync + PTY, no mocks). This
app is keyboard-driven, so both an automated rule audit and a documented-shortcut/focus pass
are reported.

## Methodology

- **Harness:** `apps/desktop/e2e/_a11y.spec.ts` — a measurement tool that injects the
  `axe-core` source (`page.addScriptTag({ path: require.resolve("axe-core") })`) and runs
  `axe.run()` against the live DOM, then exercises every documented keyboard journey and
  records pass/fail (so a real gap is reported, not aborted on).
- **Engine:** `axe-core` 4.12.1 (MIT), rule set `wcag2a, wcag2aa, wcag21a, wcag21aa,
  best-practice`.
- **Surfaces audited:** (1) the connected main shell (rail + content pane + status bar with a
  live workspace list), and (2) the **Settings (Keyboard shortcuts) dialog open** — both
  scoped to the dialog and as a full-page run.
- **Machine:** Windows 10 `10.0.19045`, Chromium via Playwright `1.60.0`. Real host booted by
  `e2e/global-setup.ts`.

## axe-core results — violations by impact

### Main shell (connected) — 36 rules pass, 3 violations

| Impact | Rule | Nodes | Where |
|---|---|---|---|
| **critical** | `aria-valid-attr-value` | 1 | `#…-tab-terminal` (the Terminal tab button) |
| **serious** | `color-contrast` | 1 | selected rail row's trailing branch label (`.bg-accent-bg … .text-fg-subtle`) |
| moderate | `page-has-heading-one` | 1 | `html` (no `<h1>` on the page) |

### Settings dialog open — 18 rules pass (scoped), 1 violation

| Impact | Rule | Nodes | Where |
|---|---|---|---|
| **serious** | `color-contrast` | 2 | the two section headings `<h3>` ("Workspace & navigation", "Terminal") |

Note: the full-page run **with the modal dialog open** surfaces only the dialog's two contrast
nodes — the shell's critical/contrast violations drop out because the native `<dialog>`
`showModal()` makes the background `inert`, which is itself a positive accessibility signal
(the modal correctly removes the backdrop from the a11y tree).

## Keyboard navigation + focus — all checks pass

All nine documented keyboard journeys verified against the real renderer:

- Workspace **next** (`Ctrl+Alt+ArrowDown`) and **prev** (`Ctrl+Alt+ArrowUp`) change selection — pass.
- Open **Settings** (`Ctrl+Comma`), **New worktree** (`Ctrl+Alt+Shift+N`), **Open project**
  (`Ctrl+Alt+O`) — all open via keyboard — pass.
- **Terminal preset slot** `Ctrl+1` runs the preset and streams real output to the xterm — pass.
- **Focus trap:** on dialog open, `document.activeElement` moves inside the dialog; 12× `Tab`
  keeps focus trapped within the dialog; **Escape** closes it — all pass.

The focus behavior is correct because dialogs are built on the native `<dialog>` element with
`showModal()` (real platform focus trapping, Escape-to-close, inert background). Interactive
controls use `focus-visible:ring` styling, and the Tabs component implements roving tabindex +
Arrow/Home/End navigation. **No keyboard-reachability gaps were found.**

## Verdict — ship-quality

There **are** blocking-tier violations: **1 critical and 2 serious** (the dialog contrast issue
counts as one serious rule across two nodes). These should be fixed before ship-quality sign-off.
The moderate item is a follow-up. Concrete fixes:

1. **CRITICAL — `aria-valid-attr-value` on the content tabs.** Root cause is in the design
   system, not the desktop app: `packages/ui/src/react/Tabs.tsx` always emits
   `aria-controls={`${baseId}-panel-${value}`}` on each `role="tab"` button, but `ContentTabs`
   renders the Tabs with `renderPanel={false}` (Terminal/Diff panels live outside the Tabs), so
   that panel id never exists in the DOM and `aria-controls` dangles. **Fix:** only emit
   `aria-controls` when the panel is actually rendered, e.g.
   `aria-controls={renderPanel ? `${baseId}-panel-${item.value}` : undefined}`. One-line guard,
   fixes the only critical violation.

2. **SERIOUS — `color-contrast` (2 spots), low-contrast `text-fg-subtle` small text.**
   - Selected rail row trailing branch label: `text-fg-subtle` (mono, 2xs) on the selected row's
     `bg-accent-bg` fails the 4.5:1 small-text threshold (`apps/desktop/src/renderer/WorkspaceRail.tsx`).
     Raise that trailing text to a higher-contrast token (e.g. `text-fg-muted`/`text-fg`) on the
     selected state, or add an accent-on-accent foreground token that meets 4.5:1.
   - Settings dialog section headings `<h3>` use `text-fg-subtle` uppercase 2xs
     (`apps/desktop/src/renderer/settings/SettingsDialog.tsx`) and fail 4.5:1 on the overlay
     background. Use `text-fg-muted` (or a dedicated section-label token) so the headings clear
     the small-text threshold.

3. **MODERATE (follow-up) — `page-has-heading-one`.** No `<h1>` on the page; the "Grove" title in
   the titlebar is a styled `<span>`. Promote it to an `<h1>` (or add a visually-hidden `<h1>`)
   so the document has a top-level heading. Log as a Phase-3 follow-up; does not block ship.

## Summary

- Automated audit: **1 critical**, **2 serious** (1 rule, 2 nodes), **1 moderate**;
  36 (shell) / 18 (dialog) rules pass.
- Keyboard navigation + focus trap: **all 9 checks pass — no reachability gaps**.
- Ship-quality call: address the 1 critical (`aria-controls` dangling reference) and the serious
  contrast issues; the moderate heading item is a logged follow-up.

Reproduce: from `apps/desktop`, `node ./node_modules/@playwright/test/cli.js test e2e/_a11y.spec.ts`
(violations + keyboard results are written to `grove-a11y-results.json` in the OS temp dir).
