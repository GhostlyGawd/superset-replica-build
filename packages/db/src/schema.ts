import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { HostId, PresetId, ProjectId, SessionId, WorkspaceId } from "@swarm/shared";
import {
  type AgentPreset,
  CHANGE_TYPES,
  type EventRow,
  type FileChangeRow,
  type Project,
  SESSION_MODES,
  type Session,
  WORKSPACE_STATUSES,
  type Workspace,
} from "./index";

/**
 * @swarm/db — the Drizzle (Postgres dialect) schema (spec §3.2). The same tables
 * run on embedded PGlite (default) and a real Postgres server (ADR-0003); only
 * the connection in `store.ts` differs. Row shapes are branded back to the
 * contracts in `./index` so the whole monorepo agrees on the data model, and a
 * compile-time conformance block at the bottom proves it.
 *
 * `events` is the append-only spine of sync: a single monotonic `seq` per host.
 * Every other "live" table is a projection the engine maintains as it appends
 * events, so a fresh client rebuilds state purely by folding the log.
 */

// ── Enums ────────────────────────────────────────────────────────────────────
export const workspaceStatusEnum = pgEnum("workspace_status", WORKSPACE_STATUSES);
export const changeTypeEnum = pgEnum("change_type", CHANGE_TYPES);
export const sessionModeEnum = pgEnum("session_mode", SESSION_MODES);

// ── Core tables ────────────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: text("id").$type<ProjectId>().primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  localPath: text("local_path"),
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").$type<WorkspaceId>().primaryKey(),
    projectId: text("project_id")
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    branch: text("branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    worktreePath: text("worktree_path").notNull(),
    status: workspaceStatusEnum("status").notNull().default("idle"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workspaces_project_idx").on(t.projectId)],
);

export const agentPresets = pgTable("agent_presets", {
  id: text("id").$type<PresetId>().primaryKey(),
  name: text("name").notNull(),
  adapterId: text("adapter_id").notNull(),
  command: text("command").notNull(),
  args: jsonb("args").$type<string[]>().notNull().default([]),
  promptTemplate: text("prompt_template"),
  model: text("model"),
  env: jsonb("env").$type<Record<string, string>>().notNull().default({}),
  icon: text("icon"),
  enabled: boolean("enabled").notNull().default(true),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").$type<SessionId>().primaryKey(),
    workspaceId: text("workspace_id")
      .$type<WorkspaceId>()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    presetId: text("preset_id")
      .$type<PresetId>()
      .references(() => agentPresets.id, { onDelete: "set null" }),
    adapterId: text("adapter_id").notNull(),
    mode: sessionModeEnum("mode").notNull(),
    pid: integer("pid"),
    status: text("status").notNull(),
    exitCode: integer("exit_code"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    index("sessions_workspace_idx").on(t.workspaceId),
    index("sessions_preset_idx").on(t.presetId),
  ],
);

/** Append-only sync backbone. `seq` is one monotonic counter per host. */
export const events = pgTable(
  "events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    hostId: text("host_id").$type<HostId>().notNull(),
    workspaceId: text("workspace_id").$type<WorkspaceId>(),
    sessionId: text("session_id").$type<SessionId>(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // `seq` PK already provides the ordered read-from-cursor index; this composite
    // serves per-host tailing (`seq > cursor AND host_id = ?`).
    index("events_host_seq_idx").on(t.hostId, t.seq),
    index("events_workspace_idx").on(t.workspaceId),
    index("events_session_idx").on(t.sessionId),
    index("events_type_idx").on(t.type),
  ],
);

export const fileChanges = pgTable(
  "file_changes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .$type<WorkspaceId>()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    changeType: changeTypeEnum("change_type").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("file_changes_workspace_path_idx").on(t.workspaceId, t.path)],
);

// ── Terminal / command presets (Ctrl+1-9) ──────────────────────────────────────
export const commandPresets = pgTable(
  "command_presets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    label: text("label").notNull(),
    command: text("command").notNull(),
    shell: text("shell"),
  },
  (t) => [index("command_presets_project_idx").on(t.projectId)],
);

export const ports = pgTable(
  "ports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .$type<WorkspaceId>()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    pid: integer("pid"),
    process: text("process"),
    protocol: text("protocol").notNull().default("tcp"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [index("ports_workspace_idx").on(t.workspaceId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .$type<WorkspaceId>()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notifications_workspace_idx").on(t.workspaceId)],
);

// ── Host / client / device tables ───────────────────────────────────────────────
export const hosts = pgTable("hosts", {
  id: text("id").$type<HostId>().primaryKey(),
  deviceName: text("device_name").notNull(),
  os: text("os").notNull(),
  endpoint: text("endpoint"),
  online: boolean("online").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  owner: text("owner"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const hotkeyOverrides = pgTable(
  "hotkey_overrides",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull(),
    binding: text("binding").notNull(),
    osScope: text("os_scope"),
  },
  (t) => [uniqueIndex("hotkey_overrides_action_os_idx").on(t.actionId, t.osScope)],
);

/** Per-client resume high-water mark — the only state a client needs to resume sync. */
export const syncCursors = pgTable("sync_cursors", {
  clientId: text("client_id").primaryKey(),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

/** Every table, for the Drizzle client's relational/query layer in `store.ts`. */
export const schema = {
  projects,
  workspaces,
  agentPresets,
  sessions,
  events,
  fileChanges,
  commandPresets,
  ports,
  notifications,
  hosts,
  pushSubscriptions,
  hotkeyOverrides,
  syncCursors,
};

// ── Compile-time conformance ────────────────────────────────────────────────────
// The drizzle row shapes MUST satisfy the hand-written contracts in `./index`
// that every other package imports. If a column drifts from the contract this
// stops compiling (the `extends` constraint fails), which is the whole point.
type Conforms<Row extends Contract, Contract> = Row;
/** Exported only so the unused-locals check retains the witnesses; the `extends`
 *  constraint inside `Conforms` is what actually enforces alignment. No runtime. */
export type RowContractWitnesses = {
  projects: Conforms<typeof projects.$inferSelect, Project>;
  workspaces: Conforms<typeof workspaces.$inferSelect, Workspace>;
  agentPresets: Conforms<typeof agentPresets.$inferSelect, AgentPreset>;
  sessions: Conforms<typeof sessions.$inferSelect, Session>;
  events: Conforms<typeof events.$inferSelect, EventRow>;
  fileChanges: Conforms<typeof fileChanges.$inferSelect, FileChangeRow>;
};
