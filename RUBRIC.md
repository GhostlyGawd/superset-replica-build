# RUBRIC.md — Definition of Done, Anti-Laziness & Anti-Slop Bar (spec §6)

Nothing is "done" on a builder's word. An **independent Critic** (never the builder) verifies each
item against evidence in `evidence/<phase>/` and may **reject and send back**.

## 6.1 Definition of Done (every phase)
- [ ] Builds clean; **Biome lint** clean; **`tsc` typecheck** clean (no `any`-escapes to dodge it).
- [ ] **Real tests pass:** unit + integration + **Playwright e2e** of the actual user journey — meaningful coverage, not assertion-free smoke.
- [ ] **It actually runs:** the relevant client launches and the targeted journey works against the real host engine; captured as evidence.
- [ ] **No banned tokens** in shipped source (cross-platform ripgrep):
      `rg -ni "TODO|FIXME|XXX|HACK|not implemented|coming soon|placeholder|lorem ipsum|throw new Error\(['\"]unimplemented"` → nothing. Dead/commented-out code removed.
- [ ] **Cross-platform CI green:** `windows-latest` + `macos-latest` + `ubuntu-latest` all pass (build, lint, typecheck, unit/integration/e2e). A red OR skipped Windows job = NOT done.
- [ ] **No mock masquerading as a feature** — mocks/fixtures live only behind test/local-dev flags, never on a user happy path.
- [ ] Linear issue → Done; `CHANGELOG.md` updated; committed.

## 6.2 "Prove it" — evidence mandatory
Each completion claim is backed by an artifact under `evidence/<phase>/`: passing test logs, an e2e
run recording/trace, screenshots at **desktop and phone** breakpoints, the **green Windows+macOS+Linux
CI run (logs/links) + a Windows desktop launch screenshot/trace**, a performance report, an
accessibility report, a license-audit report. **No evidence ⇒ not done.** Critic checks the artifact, not prose.

## 6.3 Anti-slop design bar (Critic rejects on any failure)
- [ ] Stated **original design thesis** in `docs/design-system.md` (POV, references, what it deliberately avoids).
- [ ] **Intentional system:** real type scale w/ rationale; deliberate, accessible color system (state semantics, not random hues); spacing/radii/elevation tokens; motion language w/ purpose + reduced-motion support.
- [ ] **Forbidden defaults:** NO generic centered-hero + purple/indigo gradient + three emoji feature cards; NO unmodified component-library defaults; NO stock-everything.
- [ ] **Coherence & craft:** consistent components; real empty/loading/error states; developer-tool density; pixel polish at every breakpoint.
- [ ] **Functional & fast**, not just pretty — design serves the dense, real-time, multi-agent workflow.

## 6.4 Quality bar — every dimension scored ≥ ship-quality
Frontend design · Backend design · Tooling/language choices · UX · Functionality · Performance/speed ·
Accessibility · Security · Mobile-native feel · Docs. Any dimension below bar blocks the phase.
**Speed budgets** (recorded in `evidence/` and met): interaction latency, terminal stream latency, cold start.

## 6.5 Critic protocol
Per phase the Critic writes `evidence/<phase>/review.md`: per-rubric **PASS/FAIL + the proof inspected**.
On any FAIL → Orchestrator dispatches a fix wave → re-run gate. Phase is done only on an **all-PASS**
review by a Critic that **did not build it**.
