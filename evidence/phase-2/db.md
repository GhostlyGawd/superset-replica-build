# Phase 2 — `packages/db`: Drizzle + PGlite persistence

Self-hosted Postgres per ADR-0003 (PARITY P10). Drizzle ORM (Postgres dialect) over
embedded **PGlite** by default; the same schema/migrations run against a real Postgres
server when `DATABASE_URL` is a `postgres://` URL.

## Files

- `src/schema.ts` — Drizzle pg schema (13 tables, 3 enums) + compile-time row conformance.
- `src/store.ts` — store/client factory, connection selection, migrate-on-open, typed hot-path helpers.
- `src/index.ts` — **unchanged**; remains the dependency-free type/enum/contract surface the rest of the monorepo imports (`WorkspaceStatus`, `ChangeType`, `Project`, …). Drizzle is deliberately kept out of it so the type-only consumers (api, core-engine, ui, git-worktree) don't need drizzle resolved.
- `drizzle.config.ts` — drizzle-kit config (`dialect: postgresql`, schema → `./migrations`).
- `migrations/0000_curved_newton_destine.sql` (+ `meta/`) — generated initial migration.
- `src/store.test.ts` — real PGlite test (no mocks).

## Tables (spec §3.2)

`projects`, `workspaces`, `agent_presets`, `sessions`, `events`, `file_changes`,
`command_presets`, `ports`, `notifications`, `hosts`, `push_subscriptions`,
`hotkey_overrides`, `sync_cursors`.

- Proper pg types: `text` PKs (app-generated branded ids), `jsonb` (`payload`, `args`, `env`,
  `keys`), `boolean`, `integer`, `timestamptz` (`mode:"string"` → ISO strings matching the
  `@swarm/db` row contracts), pg `ENUM`s for `workspace_status` / `change_type` / `session_mode`.
- FKs with `onDelete` (cascade / set null) on every child→parent edge; indexes on all FKs.
- **`events`** is the append-only spine: `seq bigserial PRIMARY KEY` (one monotonic counter per
  host) → the ordered read-from-cursor index. Plus `events_host_seq_idx (host_id, seq)` for
  per-host tailing, and indexes on `workspace_id`, `session_id`, `type`.
- Row shapes are branded back to `./index` via `.$type<…>()`; a `RowContractWitnesses` type
  enforces `$inferSelect ⊇ contract` at compile time (drift → typecheck fails).

## Connection selection + migrations

`openStore({ databaseUrl?, dataDir? })` resolves the target from option → `process.env.DATABASE_URL`
→ `DEFAULT_DATABASE_URL` (`file://./.data/pg`):

- `postgres://` / `postgresql://` → real Postgres via `drizzle-orm/node-postgres` + `pg`, loaded
  lazily through non-literal specifiers so the optional `pg` driver isn't required for the default
  PGlite path (clear error if a server URL is used without it).
- `file://…` or a bare path → **PGlite** at that data dir.

On open it connects then runs the drizzle migrator (`migrate(db, { migrationsFolder })`) so a fresh
user gets a ready DB with **no manual step**. Migrations folder is resolved from
`import.meta.url` via `node:path` to `<package>/migrations` (works from `src/` and `dist/` alike).
Regenerate with `bun run db:generate`. Reachable for the host engine via subpath exports
`@swarm/db/store` and `@swarm/db/schema`.

## Windows path handling (the gotcha + fix)

`fileURLToPath` rejects a **relative** file URL, and the default `file://./.data/pg` is relative —
so naive parsing throws on Windows. Fix (`fileUrlToDir`): if the part after `file://` starts with
`/` it's an absolute URL → use `fileURLToPath` (correctly maps Windows drive letters / UNC);
otherwise strip `file://` and `path.resolve(cwd, rest)`. All path math is `node:path`; the test
uses `mkdtempSync(path.join(tmpdir(), …))` — no hardcoded `/`. Verified on the Windows 10 host.

## Event-log append / read-from-seq proof (the sync backbone)

Test `event log — monotonic seq, ordering, no gaps` appends **64** events to a real PGlite DB and
asserts:

- first `seq == base+1`, each successive `seq` increases by **exactly 1** (single-writer ⇒ gapless),
  last `seq == base+64`, and `maxSeq()` agrees.
- `readEventsFromSeq(base)` returns all 64 in strict ascending order with **no gaps**; jsonb payload
  survives the round-trip.
- resume from a mid-stream cursor returns exactly the tail (`tail[0].seq == cursor+1`).
- `{ hostId, limit }` returns the first N for that host in order (per-host tailing).

## Green results (Windows host, Node 24.14.1 / Bun 1.3.14)

```
bun run --filter @swarm/db typecheck   → Exited with code 0
bun run --filter @swarm/db build       → index.js 0.57 KB — Exited with code 0
bun test packages/db                   → 6 pass / 0 fail / 160 expect() calls
banned-token scan (RUBRIC §6.1) over packages/db → rg exit 1 (clean, no matches)
```

## Deps added (to `packages/db` only; root `package.json` untouched)

- `@electric-sql/pglite@^0.5.2`, `drizzle-orm@^0.45.2`
- dev: `drizzle-kit@^0.31.10`

`bun.lock` updated by `bun add` (Orchestrator regenerates the root lock at merge). No full-repo
install/build was run; no commit/push.
