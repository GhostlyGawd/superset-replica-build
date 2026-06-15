import type { HostId, PresetId, ProjectId, SessionId, WorkspaceId } from "@swarm/shared";

/**
 * @swarm/db — the Drizzle schema's row shapes and enums, expressed as types so
 * every package agrees on the data model (spec §3.2). Drizzle tables and the
 * PGlite/Postgres connection (ADR-0003) attach to these in Phase 2.
 */

export const DB_VERSION = "0.1.0";

/** DATABASE_URL default selects embedded PGlite per ADR-0003. */
export const DEFAULT_DATABASE_URL = "file://./.data/pg";

export const WORKSPACE_STATUSES = ["idle", "running", "needs_attention", "error", "done"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const CHANGE_TYPES = ["added", "modified", "deleted", "renamed"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const SESSION_MODES = ["terminal", "chat"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly repoUrl: string | null;
  readonly localPath: string | null;
  readonly defaultBranch: string;
  readonly createdAt: string;
}

export interface Workspace {
  readonly id: WorkspaceId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly worktreePath: string;
  readonly status: WorkspaceStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

export interface AgentPreset {
  readonly id: PresetId;
  readonly name: string;
  readonly adapterId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly promptTemplate: string | null;
  readonly model: string | null;
  readonly env: Readonly<Record<string, string>>;
  readonly enabled: boolean;
}

export interface Session {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly presetId: PresetId | null;
  readonly adapterId: string;
  readonly mode: SessionMode;
  readonly pid: number | null;
  readonly status: string;
  readonly exitCode: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** Append-only spine of the sync log; `seq` is one monotonic counter per host. */
export interface EventRow {
  readonly seq: number;
  readonly hostId: HostId;
  readonly workspaceId: WorkspaceId | null;
  readonly sessionId: SessionId | null;
  readonly type: string;
  readonly payload: unknown;
  readonly actor: string;
  readonly createdAt: string;
}

export interface FileChangeRow {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly path: string;
  readonly changeType: ChangeType;
  readonly additions: number;
  readonly deletions: number;
  readonly computedAt: string;
}

/** A persisted keyboard-shortcut override (P09). `scope` names the surface the
 *  binding applies to (e.g. `desktop`); `null` is the all-surfaces default. */
export interface HotkeyOverride {
  readonly id: string;
  readonly actionId: string;
  readonly binding: string;
  readonly scope: string | null;
}

/** A user-facing notification row (P04/P12). `workspaceId` is null for host-wide
 *  notices; `read` drives the unread filter the phone's inbox uses. */
export interface Notification {
  readonly id: string;
  readonly workspaceId: WorkspaceId | null;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly createdAt: string;
}

/** A stored Web Push subscription (VAPID; ADR-0014). `endpoint` is the push
 *  service URL (unique per device); `keys` carries the `p256dh`/`auth` the
 *  payload is encrypted against. The bearer never lives here. */
export interface PushSubscriptionRecord {
  readonly id: string;
  readonly endpoint: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly createdAt: string;
}

/** Table names in one place so schema and queries cannot drift. */
export const TABLES = {
  projects: "projects",
  workspaces: "workspaces",
  agentPresets: "agent_presets",
  sessions: "sessions",
  events: "events",
  fileChanges: "file_changes",
} as const;
