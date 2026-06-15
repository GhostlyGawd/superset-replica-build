# Phase 2 — Critic follow-up contract fixes (wave 1b)

Closes the two non-blocking contract gaps the Phase-0 Critic flagged
(`STATE.json → critic_followups_for_phase2`, items 1–2 / `evidence/phase-0/review.md`
"Required fixes" 1–2). These remain **typed contracts** — runtime resolvers land in later
Phase-2 waves — but the contract surface is now complete and honest, not overclaimed.

## FIX 1 — `packages/api`: complete the tRPC router surface (§3.1)

Before: `AppRouter` exposed **6** routers (projects, workspaces, agents, terminal, diffs,
config) — several partial — and a comment called it the "full tRPC surface" (inaccurate).

After: `AppRouter` exposes **all 13** routers of architecture §3.1, in spec order:

| # | Router | Status | Procedures |
|---|--------|--------|------------|
| 1 | `projects` | unchanged | list, create, get, remove |
| 2 | `workspaces` | **completed** | + openExternal, importExternal, onStatus (sub) |
| 3 | `agents` | **completed** | + upsertPreset; `start.presetId` now `PresetId` |
| 4 | `sessions` | **added** | list, onActivity (sub) |
| 5 | `terminal` | **completed** | + listShells, onData (sub) |
| 6 | `diffs` | **completed** | + discard |
| 7 | `presets` | **added** | list, run (command presets, Ctrl+1–9) |
| 8 | `config` | **completed** | + runSetup, runTeardown, runRun |
| 9 | `ports` | **added** | scan, onPorts (sub) |
| 10 | `notifications` | **added** | list, markRead, subscribePush |
| 11 | `settings` | **added** | getHotkeys, setHotkey, export/importHotkeys, get/setAgent |
| 12 | `host` | **added** | status, info, connect |
| 13 | `auth` | **added** | session, loginGitHub, logout |

- Every procedure carries precise input/output types drawn from `@swarm/db`
  (`Project`, `Workspace`, `Session`, `AgentPreset`, `WorkspaceStatus`),
  `@swarm/git-worktree` (`FileChange`, `FileDiff`), `@swarm/agent-adapters`
  (`AdapterDescriptor`), and `@swarm/shared` branded ids (`ProjectId`, `WorkspaceId`,
  `SessionId`, `PresetId`, `HostId`, `PtyId`).
- API-surface DTOs specified inline by §3.1 are defined in `packages/api`:
  `WorkspaceStatusUpdate`, `ShellDescriptor`, `CommandPreset` (+ `PresetSlot` 1–9),
  `Port` (+ `PortProtocol`), `Notification`, `PushSubscriptionInput`, `HotkeyBinding`,
  `HostStatusSummary`, `HostInfo`, `SessionActivity`, `AgentPresetInput`, `AuthSession`,
  `ExternalTarget`, `OsName`.
- Subscriptions modeled as `Subscription<T> = AsyncIterable<T>` (the sync-channel stream,
  spec §4); the tRPC runtime attaches in Phase 2.
- Honesty note: `auth.session()` returns a new `AuthSession` (user/gh session), explicitly
  documented as **distinct** from the agent `Session` in `@swarm/db` — conflating them
  would be a real bug, so the spec's bare `Session` is disambiguated rather than reused.
- The misleading comment was corrected to "all 13 routers of architecture §3.1".
- `apps/host` and `apps/mobile` only re-export `AppRouter` as a type, so the expansion is
  non-breaking (both typecheck green).

## FIX 2 — `packages/config`: `SwarmConfig` arrays + per-field overlay (recon §6 / §2)

Before: `SwarmConfig` modeled single `CommandSpec` commands + a flat top-level
`before`/`after`. After:

- `setup` / `teardown` / `run` are **ordered arrays of `Command`s**.
- A `Command` is cross-platform: either a bare string (runs on each OS's default shell) or
  a per-OS `PlatformCommand` `{ windows?, posix? }` where each branch is a string or a
  `ShellCommand { run, shell? }` pinned to a shell from `SHELLS`
  (`pwsh|powershell|cmd|bash|sh|zsh|wsl`, spec §5). This closes the original's `.sh`-only
  assumption (recon §11, ADR-0004) so Windows PowerShell/cmd and POSIX sh all work.
- A **per-field before/after overlay** (`SwarmConfigOverlay`, the gitignored
  `.swarm/config.local.json`): each field is `{ before?, after? }`. `mergeConfig` resolves
  each field to `[...before, ...committed, ...after]`.
- Env vars retained as `SWARM_ROOT_PATH` / `SWARM_WORKSPACE_NAME` / `SWARM_WORKSPACE_PATH`
  (the Grove-codename equivalents of `SUPERSET_*`, matching architecture §2 verbatim and
  the repo-wide `@swarm/*` / `APP_CODENAME` convention).
- Typed validator (zero external deps; uses `@swarm/shared`'s `Result`/`ok`/`err`):
  `parseConfig`, `parseOverlay`, `mergeConfig`, returning `Result<…, ConfigError>` with a
  dotted error `path` (e.g. `setup[0].windows.shell`). Rejects unknown fields, empty
  command strings, non-string/non-object commands, unknown shells, and per-OS objects that
  set neither branch.

### Tests added — `packages/config/src/index.test.ts` (9 tests, all pass)

- parseConfig: valid string-command arrays parse + missing field defaults to `[]`; a per-OS
  command with a shell-specific Windows line parses; rejects unknown top-level field,
  non-string/non-object command, unknown shell, and a per-OS object missing both branches.
- mergeConfig: overlay `before`/`after` prepend/append per field; empty overlay is a no-op;
  `DEFAULT_CONFIG` = `{ setup: [], teardown: [], run: [] }`.

## Local results (Windows)

| Gate | Result |
|------|--------|
| `bun install` | OK — added `@swarm/shared` workspace dep to `@swarm/config`; **`bun.lock` updated** (commit with `packages/config/package.json`). |
| `bun run lint` (Biome) over `apps packages docs` | **clean** — "Checked 92 files. No fixes applied." None of the changed `packages/api` / `packages/config` files flagged. |
| `bun run typecheck` (strict tsc) | **17/17 successful**. |
| `bun run build` (turbo) | **17/17 successful**. |
| `bun run test` | **3/3 tasks pass**; `@swarm/config` = **9 pass / 0 fail**; suite green (shared + ui + config). |
| Banned-token scan over `apps packages docs` | **clean** (zero matches). |

### Caveats for the Orchestrator (not part of this deliverable)

1. **Pre-existing lint break fixed:** `evidence/phase-1/_shots.mjs` (throwaway Playwright
   screenshot tooling, not shipped) had an unsorted import that failed `biome check` on a
   clean tree. Reordered the two `node:` imports to restore green. One-line, mechanical.
2. **Sibling scratch noise:** the full-tree `biome check .` additionally flags only
   `evidence/phase-2/pty-probe/**` (`hb/`, `np/` — package.json/worker.ts/sup.ts/probe.cjs),
   the parallel **wave-1a pty-validation** agent's untracked scratch. These are not part of
   this deliverable and not shippable source (the dir carries vendored `node_modules`); they
   should be gitignored or removed before commit. All `apps packages docs` source is clean.
