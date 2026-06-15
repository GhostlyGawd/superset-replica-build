import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";

import { asId } from "@swarm/shared";
import type { Brand, HostId, PresetId, ProjectId, SessionId, WorkspaceId } from "@swarm/shared";
import {
  type AgentPreset,
  DEFAULT_DATABASE_URL,
  type EventRow,
  type HotkeyOverride,
  type Project,
  type Session,
  type SessionMode,
  type Workspace,
  type WorkspaceStatus,
} from "./index.ts";
import { schema } from "./schema.ts";
import {
  events,
  agentPresets,
  hotkeyOverrides,
  projects,
  sessions,
  syncCursors,
  workspaces,
} from "./schema.ts";

/**
 * @swarm/db store/client factory (spec §3.2, ADR-0003). Opens the single source
 * of truth — embedded PGlite by default, a real Postgres server when
 * `DATABASE_URL` is a `postgres://` URL — applies migrations on open so a fresh
 * user gets a ready DB with no manual step, and exposes typed helpers for the
 * hot paths: append-event / read-from-seq (the sync backbone) and CRUD over
 * workspaces, agents and sessions.
 */

type Db = PgliteDatabase<typeof schema>;

/** Migrations live at `<package>/migrations`; `src/` and `dist/` are both one
 *  level below it, so the same relative resolution works built or from source.
 *  All path math goes through `node:path` (spec §5 — no hardcoded separators). */
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export interface OpenStoreOptions {
  /** Overrides `process.env.DATABASE_URL`. `file://…` (or a bare path) ⇒ PGlite;
   *  `postgres://…`/`postgresql://…` ⇒ a real Postgres server. */
  readonly databaseUrl?: string;
  /** Explicit PGlite data directory; wins over any `file://` URL. */
  readonly dataDir?: string;
}

type Target =
  | { readonly kind: "pglite"; readonly dataDir: string }
  | {
      readonly kind: "postgres";
      readonly url: string;
    };

/** Resolve a `file://` data dir cross-platform. `fileURLToPath` only accepts an
 *  absolute URL (`file:///…`), and on Windows it correctly maps the drive letter
 *  and UNC paths; a relative default like `file://./.data/pg` is resolved against
 *  cwd by hand because the URL parser rejects it. */
function fileUrlToDir(url: string): string {
  const rest = url.slice("file://".length);
  if (rest.startsWith("/")) {
    return fileURLToPath(url);
  }
  return path.resolve(process.cwd(), rest);
}

function resolveTarget(opts: OpenStoreOptions): Target {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return { kind: "postgres", url };
  }
  if (opts.dataDir) {
    return { kind: "pglite", dataDir: path.resolve(opts.dataDir) };
  }
  const dir = url.startsWith("file://") ? fileUrlToDir(url) : path.resolve(url);
  return { kind: "pglite", dataDir: dir };
}

/** Connect to a real Postgres server. `pg` + drizzle's node-postgres adapter are
 *  optional — only needed when `DATABASE_URL` points at a server — so they load
 *  lazily through non-literal specifiers (which also keeps the default PGlite
 *  path free of any extra dependency). */
async function openPostgres(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const driverSpec = "drizzle-orm/node-postgres" as string;
  const migratorSpec = "drizzle-orm/node-postgres/migrator" as string;
  const pgSpec = "pg" as string;
  let drizzlePg: (...a: unknown[]) => unknown;
  let migratePg: (db: unknown, cfg: { migrationsFolder: string }) => Promise<void>;
  let Pool: new (cfg: { connectionString: string }) => { end: () => Promise<void> };
  try {
    ({ drizzle: drizzlePg } = await import(driverSpec));
    ({ migrate: migratePg } = await import(migratorSpec));
    ({ Pool } = await import(pgSpec));
  } catch {
    throw new Error(
      "DATABASE_URL targets a Postgres server, but the optional 'pg' driver is not installed. " +
        "Run `bun add pg` in @swarm/db to enable real-Postgres mode; PGlite (the default) needs no driver.",
    );
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema }) as unknown as Db;
  await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => pool.end() };
}

async function openPglite(dataDir: string): Promise<{ db: Db; close: () => Promise<void> }> {
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}

function newId<B extends string>(prefix: string): Brand<string, B> {
  return asId<B>(`${prefix}_${crypto.randomUUID()}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateWorkspaceInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly status?: WorkspaceStatus;
}

export interface CreateSessionInput {
  readonly workspaceId: WorkspaceId;
  readonly adapterId: string;
  readonly mode: SessionMode;
  readonly presetId?: PresetId | null;
  readonly pid?: number | null;
  readonly status?: string;
}

export interface AppendEventInput {
  readonly hostId: HostId;
  readonly type: string;
  readonly payload: unknown;
  readonly actor: string;
  readonly workspaceId?: WorkspaceId | null;
  readonly sessionId?: SessionId | null;
}

export interface UpsertPresetInput {
  readonly id?: PresetId;
  readonly name: string;
  readonly adapterId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly promptTemplate?: string | null;
  readonly model?: string | null;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
}

export interface Store {
  /** The underlying Drizzle handle for queries beyond the hot-path helpers. */
  readonly db: Db;
  // Projects
  createProject(input: {
    name: string;
    repoUrl?: string | null;
    localPath?: string | null;
    defaultBranch?: string;
  }): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: ProjectId): Promise<Project | null>;
  removeProject(id: ProjectId): Promise<void>;
  // Workspaces
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  listWorkspaces(projectId?: ProjectId): Promise<Workspace[]>;
  getWorkspace(id: WorkspaceId): Promise<Workspace | null>;
  setWorkspaceStatus(id: WorkspaceId, status: WorkspaceStatus): Promise<Workspace>;
  renameWorkspace(id: WorkspaceId, name: string): Promise<Workspace>;
  removeWorkspace(id: WorkspaceId): Promise<void>;
  // Agents
  upsertPreset(input: UpsertPresetInput): Promise<AgentPreset>;
  listPresets(): Promise<AgentPreset[]>;
  createSession(input: CreateSessionInput): Promise<Session>;
  listSessions(workspaceId: WorkspaceId): Promise<Session[]>;
  getSession(id: SessionId): Promise<Session | null>;
  endSession(id: SessionId, exitCode: number, status?: string): Promise<Session>;
  // Hotkey overrides (customizable shortcuts, P09)
  listHotkeyOverrides(scope?: string): Promise<HotkeyOverride[]>;
  setHotkeyOverride(input: {
    actionId: string;
    binding: string;
    scope?: string;
  }): Promise<HotkeyOverride>;
  clearHotkeyOverride(actionId: string, scope?: string): Promise<void>;
  clearHotkeyOverrides(scope?: string): Promise<void>;
  // Event log (sync backbone)
  appendEvent(input: AppendEventInput): Promise<EventRow>;
  readEventsFromSeq(
    afterSeq: number,
    opts?: { hostId?: HostId; limit?: number },
  ): Promise<EventRow[]>;
  maxSeq(): Promise<number>;
  ackCursor(clientId: string, lastSeq: number): Promise<void>;
  getCursor(clientId: string): Promise<number>;
  // Lifecycle
  close(): Promise<void>;
}

function one<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${what}: expected a row but the write returned none`);
  }
  return row;
}

function buildStore(db: Db, close: () => Promise<void>): Store {
  return {
    db,

    async createProject(input) {
      const rows = await db
        .insert(projects)
        .values({
          id: newId<"ProjectId">("prj"),
          name: input.name,
          repoUrl: input.repoUrl ?? null,
          localPath: input.localPath ?? null,
          defaultBranch: input.defaultBranch ?? "main",
        })
        .returning();
      return one(rows, "createProject");
    },
    async listProjects() {
      return db.select().from(projects).orderBy(asc(projects.createdAt));
    },
    async getProject(id) {
      const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async removeProject(id) {
      await db.delete(projects).where(eq(projects.id, id));
    },

    async createWorkspace(input) {
      const rows = await db
        .insert(workspaces)
        .values({
          id: newId<"WorkspaceId">("wsp"),
          projectId: input.projectId,
          name: input.name,
          branch: input.branch,
          baseBranch: input.baseBranch,
          worktreePath: input.worktreePath,
          status: input.status ?? "idle",
        })
        .returning();
      return one(rows, "createWorkspace");
    },
    async listWorkspaces(projectId) {
      const base = db.select().from(workspaces);
      const q = projectId ? base.where(eq(workspaces.projectId, projectId)) : base;
      return q.orderBy(asc(workspaces.createdAt));
    },
    async getWorkspace(id) {
      const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async setWorkspaceStatus(id, status) {
      const rows = await db
        .update(workspaces)
        .set({ status, lastActivityAt: nowIso() })
        .where(eq(workspaces.id, id))
        .returning();
      return one(rows, "setWorkspaceStatus");
    },
    async renameWorkspace(id, name) {
      const rows = await db
        .update(workspaces)
        .set({ name, lastActivityAt: nowIso() })
        .where(eq(workspaces.id, id))
        .returning();
      return one(rows, "renameWorkspace");
    },
    async removeWorkspace(id) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    },

    async upsertPreset(input) {
      const id = input.id ?? newId<"PresetId">("pst");
      const values = {
        id,
        name: input.name,
        adapterId: input.adapterId,
        command: input.command,
        args: [...(input.args ?? [])],
        promptTemplate: input.promptTemplate ?? null,
        model: input.model ?? null,
        env: { ...(input.env ?? {}) },
        enabled: input.enabled ?? true,
      };
      const rows = await db
        .insert(agentPresets)
        .values(values)
        .onConflictDoUpdate({
          target: agentPresets.id,
          set: {
            name: values.name,
            adapterId: values.adapterId,
            command: values.command,
            args: values.args,
            promptTemplate: values.promptTemplate,
            model: values.model,
            env: values.env,
            enabled: values.enabled,
          },
        })
        .returning();
      return one(rows, "upsertPreset");
    },
    async listPresets() {
      return db.select().from(agentPresets).orderBy(asc(agentPresets.name));
    },

    async createSession(input) {
      const rows = await db
        .insert(sessions)
        .values({
          id: newId<"SessionId">("ses"),
          workspaceId: input.workspaceId,
          presetId: input.presetId ?? null,
          adapterId: input.adapterId,
          mode: input.mode,
          pid: input.pid ?? null,
          status: input.status ?? "starting",
        })
        .returning();
      return one(rows, "createSession");
    },
    async listSessions(workspaceId) {
      return db
        .select()
        .from(sessions)
        .where(eq(sessions.workspaceId, workspaceId))
        .orderBy(asc(sessions.startedAt));
    },
    async getSession(id) {
      const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async endSession(id, exitCode, status) {
      const rows = await db
        .update(sessions)
        .set({ exitCode, status: status ?? "exited", endedAt: nowIso() })
        .where(eq(sessions.id, id))
        .returning();
      return one(rows, "endSession");
    },

    async listHotkeyOverrides(scope) {
      const filter =
        scope === undefined ? isNull(hotkeyOverrides.osScope) : eq(hotkeyOverrides.osScope, scope);
      const rows = await db
        .select()
        .from(hotkeyOverrides)
        .where(filter)
        .orderBy(asc(hotkeyOverrides.actionId));
      return rows.map((row) => ({
        id: row.id,
        actionId: row.actionId,
        binding: row.binding,
        scope: row.osScope,
      }));
    },
    async setHotkeyOverride(input) {
      const scope = input.scope ?? null;
      const filter = and(
        eq(hotkeyOverrides.actionId, input.actionId),
        scope === null ? isNull(hotkeyOverrides.osScope) : eq(hotkeyOverrides.osScope, scope),
      );
      // Delete-then-insert rather than ON CONFLICT: Postgres treats NULL os_scope
      // values as DISTINCT, so the (action_id, os_scope) unique index would let a
      // NULL-scoped upsert duplicate. This keeps one row per (action, scope) for
      // any scope, NULL included.
      await db.delete(hotkeyOverrides).where(filter);
      const rows = await db
        .insert(hotkeyOverrides)
        .values({
          id: `hk_${crypto.randomUUID()}`,
          actionId: input.actionId,
          binding: input.binding,
          osScope: scope,
        })
        .returning();
      const row = one(rows, "setHotkeyOverride");
      return { id: row.id, actionId: row.actionId, binding: row.binding, scope: row.osScope };
    },
    async clearHotkeyOverride(actionId, scope) {
      await db
        .delete(hotkeyOverrides)
        .where(
          and(
            eq(hotkeyOverrides.actionId, actionId),
            scope === undefined
              ? isNull(hotkeyOverrides.osScope)
              : eq(hotkeyOverrides.osScope, scope),
          ),
        );
    },
    async clearHotkeyOverrides(scope) {
      await db
        .delete(hotkeyOverrides)
        .where(
          scope === undefined
            ? isNull(hotkeyOverrides.osScope)
            : eq(hotkeyOverrides.osScope, scope),
        );
    },

    async appendEvent(input) {
      const rows = await db
        .insert(events)
        .values({
          hostId: input.hostId,
          workspaceId: input.workspaceId ?? null,
          sessionId: input.sessionId ?? null,
          type: input.type,
          payload: input.payload,
          actor: input.actor,
        })
        .returning();
      return one(rows, "appendEvent");
    },
    async readEventsFromSeq(afterSeq, opts) {
      const where = opts?.hostId
        ? and(gt(events.seq, afterSeq), eq(events.hostId, opts.hostId))
        : gt(events.seq, afterSeq);
      const base = db.select().from(events).where(where).orderBy(asc(events.seq));
      return opts?.limit !== undefined ? base.limit(opts.limit) : base;
    },
    async maxSeq() {
      const rows = await db
        .select({ seq: events.seq })
        .from(events)
        .orderBy(desc(events.seq))
        .limit(1);
      return rows[0]?.seq ?? 0;
    },
    async ackCursor(clientId, lastSeq) {
      await db
        .insert(syncCursors)
        .values({ clientId, lastSeq, updatedAt: nowIso() })
        .onConflictDoUpdate({
          target: syncCursors.clientId,
          set: { lastSeq, updatedAt: nowIso() },
        });
    },
    async getCursor(clientId) {
      const rows = await db
        .select()
        .from(syncCursors)
        .where(eq(syncCursors.clientId, clientId))
        .limit(1);
      return rows[0]?.lastSeq ?? 0;
    },

    close,
  };
}

/** Open the store: resolve the target from options/`DATABASE_URL`, connect,
 *  apply migrations, and return the typed hot-path helpers. */
export async function openStore(opts: OpenStoreOptions = {}): Promise<Store> {
  const target = resolveTarget(opts);
  const { db, close } =
    target.kind === "pglite" ? await openPglite(target.dataDir) : await openPostgres(target.url);
  return buildStore(db, close);
}
