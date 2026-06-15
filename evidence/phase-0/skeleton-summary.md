# Phase 0 — Monorepo Skeleton (SWARM) — Build Summary

Target: `v0.1.0`, spec §4 Phase 0 ("skeleton compiles, CI green"). A genuine but minimal
Turborepo + Bun monorepo: real typed contracts and a real inter-package type graph, **no**
feature implementation (features land in their phases per `docs/architecture.md`).

Host: Windows 10 · bun 1.3.14 · node v24.14.1 · turbo 2.9.18 · typescript 5.9.3 · biome 1.9.4.

## What was created

### Root config
- `package.json` — private, `workspaces: ["apps/*","packages/*"]`, `packageManager: "bun@1.3.14"`,
  scripts `build`/`typecheck`/`test` → `turbo run …`, `lint` → `biome check .`, `format` → `biome format --write .`.
- `turbo.json` — tasks `build` (`dependsOn ^build`, caches `dist/**`), `typecheck`, `test`.
- `biome.json` — Biome 1.9.4, recommended + `noExplicitAny`/`useImportType`/`useNodejsImportProtocol` errors,
  2-space, LF, width 100, double quotes; respects `.gitignore`; `STATE.json` excluded.
- `tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`,
  `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: Bundler`, `noEmit`.
- per-package `tsconfig.json` extending the base; `.nvmrc` (`22`, informational per ADR-0007).

### Packages (11, matching architecture.md §2) — each `@swarm/<pkg>`, real `src/index.ts` export
| Package | Real export | Imports (type graph) |
|---|---|---|
| `shared` | branded ids, `Result`, `toPosixPath`/`normalizeEol`, sync topics | (leaf) |
| `db` | row interfaces + status/change/mode enums, `TABLES`, default `DATABASE_URL` | shared |
| `core-engine` | `DomainEvent` union, `Reducer`, `deriveStatus()` | shared, db |
| `agent-adapters` | `AdapterDescriptor`, `BUILTIN_ADAPTERS` (Claude/Codex/Cursor/Gemini/generic) | (leaf) |
| `git-worktree` | `WorktreeRef`, `FileChange`, `DiffHunk`, `FileDiff` | shared, db |
| `pty-supervisor` | `ShellKind`, `ShellDescriptor`, `PtySession` | shared |
| `config` | `SwarmConfig`, `ENV_VARS`, `CONFIG_FILE_PATH` | (leaf) |
| `sync` | `SyncFrame` union, `ResumeToken` + base64 encode/decode | shared, core-engine |
| `api` | full tRPC router surface as interfaces, `AppRouter` | shared, db, core-engine, agent-adapters, git-worktree, config |
| `terminal` | `TerminalOptions`, `TERMINAL_ADDONS` | pty-supervisor |
| `ui` | `STATUS_TOKENS`, `SPACING`, component prop types | db |

### Apps (5, matching architecture.md §2)
| App | Real export | Imports |
|---|---|---|
| `host` | `createHost()` factory → typed `Host`/`HostStatus` (loopback bind, PGlite default) | api, db, sync, shared |
| `cli` | `parseArgv()` verb parser + `statusLine()` over the engine handle | host |
| `desktop` | `createDesktopApp()` embedding the host (Electron shell, ADR-0005) | host, ui |
| `mobile` | `createMobileApp()` seeding a resume token (PWA, ADR-0006) | api, sync, ui, shared |
| `docs` | `DOCS_NAV` / `DOCS_TITLE` site model | shared |

Type graph is real: `api` fans in from 6 packages; `host` re-exports `AppRouter`; clients import
host/api types. typecheck follows package `exports` → `src/index.ts`, so the graph is verified by `tsc`.

### CI — `.github/workflows/ci.yml`
Matrix `os: [windows-latest, macos-latest, ubuntu-latest]`, `fail-fast: false`. Steps: checkout →
`oven-sh/setup-bun@v2` (1.3.14) → `bun install --frozen-lockfile` → `bun run lint` → `bun run typecheck`
→ `bun run build` → `bun run test`. Valid YAML.

## Local results (Windows) — all PASS
| Gate | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | PASS (lockfile committed-ready) |
| Lint | `bun run lint` (biome check) | PASS — 53 files, no fixes applied |
| Typecheck | `bun run typecheck` (tsc --noEmit ×16) | PASS — 16/16 |
| Build | `bun run build` (bun build ×16) | PASS — 16/16 bundled |
| Test | `bun run test` (bun test) | PASS — 4 tests / 6 expects, 0 fail |
| Banned tokens | `rg -ni "…" apps/ packages/` | CLEAN — rg exit 1, no matches |

Full console output: `evidence/phase-0/skeleton-build.log`.

## Scope decisions (honest, not faked)
- **Pure typed contracts, runtime libs deferred to their phases.** tRPC/Hono/Drizzle/PGlite/React/
  Electron/Vite/node-pty are *not* installed in Phase 0. The skeleton exports the real contract
  shapes (router interfaces, schema row types, event unions, factory signatures) that those runtimes
  bind to later. This keeps install light and CI deterministically green on all three OSes, and
  directly respects ADR-0007 (node-pty native load is a **Phase 2** validation gate, not Phase 0).
- **No native/WASM/Docker deps in Phase 0** → no blocker encountered; nothing faked or skipped.
- Build emits via `bun build` (Bun-native, cross-platform, ADR-0004); typecheck via `tsc`; the trivial
  but real test asserts the cross-platform path/EOL helpers, so the test step is meaningful, not empty.

## Blockers
None. Every gate is green on Windows.

## Working tree
Left uncommitted/unpushed for the Orchestrator (per instructions). `dist/`, `node_modules/`,
`.turbo/` are gitignored; `bun.lock` is tracked-ready for CI's `--frozen-lockfile`.
