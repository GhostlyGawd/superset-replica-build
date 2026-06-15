import type { AdapterDescriptor } from "@swarm/agent-adapters";
import type { SwarmConfig } from "@swarm/config";
import type { DomainEvent } from "@swarm/core-engine";
import type { AgentPreset, Project, Session, Workspace, WorkspaceStatus } from "@swarm/db";
import type { FileChange, FileDiff } from "@swarm/git-worktree";
import type { HostId, PresetId, ProjectId, PtyId, SessionId, WorkspaceId } from "@swarm/shared";

/**
 * @swarm/api — the tRPC router surface (spec §3.1) expressed as interfaces.
 * Mutations are commands that append `DomainEvent`s; queries read materialized
 * state; subscriptions ride the WebSocket sync channel (spec §4). Clients import
 * `AppRouter` for end-to-end type safety; the Hono + tRPC runtime binds resolvers
 * to these shapes in Phase 2.
 */

export const API_VERSION = "0.1.0";

export interface Ok {
  readonly ok: true;
}

/**
 * A server→client stream delivered over the sync channel (spec §4), modeled as
 * an async iterable; the tRPC subscription runtime attaches to it in Phase 2.
 */
export type Subscription<T> = AsyncIterable<T>;

/** OS families the host and clients distinguish (spec §5). */
export type OsName = "windows" | "macos" | "linux";

// router: projects
export interface ProjectsRouter {
  list(): Promise<readonly Project[]>;
  create(input: {
    name: string;
    repoUrl?: string;
    localPath?: string;
    clone?: boolean;
  }): Promise<Project>;
  /** Open an existing git repo on the host as a project + seed a worktree (P08). */
  open(input: { path: string; name?: string }): Promise<{ project: Project; workspace: Workspace }>;
  get(input: { projectId: ProjectId }): Promise<Project>;
  remove(input: { projectId: ProjectId }): Promise<Ok>;
}

// router: workspaces
/** Live status pushed on `workspaces.onStatus` (spec §3.1). */
export interface WorkspaceStatusUpdate {
  readonly workspaceId: WorkspaceId;
  readonly status: WorkspaceStatus;
  readonly lastActivityAt: string;
}

/** Targets for `workspaces.openExternal` (P08): open the worktree on the host in
 *  an editor, a terminal, or the OS file manager. */
export type ExternalTarget = "editor" | "terminal" | "folder";

export interface WorkspacesRouter {
  list(input: { projectId?: ProjectId }): Promise<readonly Workspace[]>;
  create(input: {
    projectId: ProjectId;
    name: string;
    branch: string;
    baseBranch?: string;
    runSetup?: boolean;
  }): Promise<Workspace>;
  get(input: { workspaceId: WorkspaceId }): Promise<Workspace>;
  remove(input: { workspaceId: WorkspaceId; deleteBranch?: boolean }): Promise<Ok>;
  rename(input: { workspaceId: WorkspaceId; name: string }): Promise<Workspace>;
  openExternal(input: { workspaceId: WorkspaceId; target: ExternalTarget }): Promise<Ok>;
  importExternal(input: { projectId: ProjectId }): Promise<readonly Workspace[]>;
  onStatus(): Subscription<WorkspaceStatusUpdate>;
}

// router: agents
/** Upsert payload for an agent preset (Settings → Agents; recon §3). */
export interface AgentPresetInput {
  readonly id?: PresetId;
  readonly name: string;
  readonly adapterId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly promptTemplate?: string;
  readonly model?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
}

export interface AgentsRouter {
  listAdapters(): Promise<readonly AdapterDescriptor[]>;
  listPresets(): Promise<readonly AgentPreset[]>;
  upsertPreset(input: AgentPresetInput): Promise<AgentPreset>;
  start(input: { workspaceId: WorkspaceId; presetId: PresetId; prompt?: string }): Promise<Session>;
  stop(input: { sessionId: SessionId }): Promise<Ok>;
}

// router: sessions
/** Activity heartbeat the engine emits to derive idle / needs-attention (recon §3). */
export interface SessionActivity {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly lastActivityAt: string;
  readonly idle: boolean;
}

export interface SessionsRouter {
  list(input: { workspaceId: WorkspaceId }): Promise<readonly Session[]>;
  onActivity(input: { workspaceId: WorkspaceId }): Subscription<SessionActivity>;
}

// router: terminal (high-frequency IO over an ephemeral WS topic, not the durable log)
/** A shell offered by `terminal.listShells` (spec §5). */
export interface ShellDescriptor {
  readonly id: string;
  readonly label: string;
  /** Absolute path to the shell executable resolved on this host. */
  readonly path: string;
  readonly args: readonly string[];
  readonly available: boolean;
}

export interface TerminalRouter {
  listShells(): Promise<readonly ShellDescriptor[]>;
  create(input: {
    workspaceId: WorkspaceId;
    shell?: string;
    cwd?: string;
    cols: number;
    rows: number;
  }): Promise<{ ptyId: PtyId }>;
  write(input: { ptyId: PtyId; data: string }): Promise<void>;
  resize(input: { ptyId: PtyId; cols: number; rows: number }): Promise<void>;
  kill(input: { ptyId: PtyId }): Promise<void>;
  onData(input: { ptyId: PtyId }): Subscription<string>;
}

// router: diffs
export interface DiffsRouter {
  status(input: { workspaceId: WorkspaceId }): Promise<readonly FileChange[]>;
  getFileDiff(input: { workspaceId: WorkspaceId; path: string }): Promise<FileDiff>;
  writeFile(input: { workspaceId: WorkspaceId; path: string; content: string }): Promise<Ok>;
  discard(input: { workspaceId: WorkspaceId; path?: string }): Promise<Ok>;
}

// router: presets (terminal/command presets, Ctrl+1–9)
/** Preset slot bound to Ctrl+1–9 (spec §3.1, P05). */
export type PresetSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface CommandPreset {
  readonly id: PresetId;
  readonly projectId: ProjectId | null;
  readonly slot: PresetSlot;
  readonly label: string;
  readonly command: string;
  readonly shell: string | null;
}

export interface PresetsRouter {
  list(input: { projectId?: ProjectId }): Promise<readonly CommandPreset[]>;
  run(input: { workspaceId: WorkspaceId; slot: PresetSlot }): Promise<{ ptyId: PtyId }>;
}

// router: config
export interface ConfigRouter {
  read(input: { projectId: ProjectId }): Promise<SwarmConfig>;
  runSetup(input: { workspaceId: WorkspaceId }): Promise<{ ptyId: PtyId }>;
  runTeardown(input: { workspaceId: WorkspaceId }): Promise<Ok>;
  runRun(input: { workspaceId: WorkspaceId }): Promise<{ ptyId: PtyId }>;
}

// router: ports
export type PortProtocol = "tcp" | "udp";

export interface Port {
  readonly port: number;
  readonly pid: number | null;
  readonly process: string | null;
  readonly protocol: PortProtocol;
}

export interface PortsRouter {
  scan(input: { workspaceId: WorkspaceId }): Promise<readonly Port[]>;
  onPorts(input: { workspaceId: WorkspaceId }): Subscription<readonly Port[]>;
}

// router: notifications
export interface Notification {
  readonly id: string;
  readonly workspaceId: WorkspaceId | null;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly createdAt: string;
}

/** Web Push subscription payload (VAPID; spec §3.1, P04). */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface NotificationsRouter {
  list(input: { unreadOnly?: boolean }): Promise<readonly Notification[]>;
  markRead(input: { id: string }): Promise<Ok>;
  subscribePush(input: { subscription: PushSubscriptionInput }): Promise<Ok>;
}

// router: settings
/** Scope a hotkey binding to one OS or every OS (recon §5). */
export type HotkeyScope = OsName | "all";

export interface HotkeyBinding {
  readonly actionId: string;
  readonly binding: string;
  readonly scope: HotkeyScope;
}

export interface SettingsRouter {
  getHotkeys(): Promise<readonly HotkeyBinding[]>;
  setHotkey(input: { actionId: string; binding: string }): Promise<HotkeyBinding>;
  exportHotkeys(): Promise<{ json: string }>;
  importHotkeys(input: { json: string }): Promise<Ok>;
  getAgents(): Promise<readonly AgentPreset[]>;
  setAgent(input: AgentPresetInput): Promise<AgentPreset>;
}

// router: host (client↔host handshake, presence)
export interface HostStatusSummary {
  readonly hostId: HostId;
  readonly version: string;
  readonly os: OsName;
  readonly online: boolean;
  readonly boundTo: string;
}

export interface HostInfo {
  readonly hostId: HostId;
  readonly deviceName: string;
  readonly os: OsName;
  readonly endpoint: string;
  readonly online: boolean;
  readonly lastSeenAt: string;
  readonly owner: string;
}

export interface HostRouter {
  status(): Promise<HostStatusSummary>;
  info(): Promise<HostInfo>;
  connect(input: { token: string }): Promise<Ok & { resumeToken: string }>;
}

// router: pair (mobile PWA bootstrap — ADR-0014)
/** A minted pairing code: the high-entropy, single-use, short-lived secret a QR carries. */
export interface PairingCodeInfo {
  /** The code itself — NOT the bearer; safe to print/scan. */
  readonly code: string;
  /** The host endpoint a redeemer should reach (same-origin for the served PWA). */
  readonly endpoint: string;
  /** ISO-8601 instant the code stops being valid. */
  readonly expiresAt: string;
}

/** What a successful `pair.redeem` hands back — this is where the bearer first reaches the phone. */
export interface PairingGrant {
  readonly endpoint: string;
  readonly token: string;
  readonly resumeToken: string;
}

export interface PairRouter {
  /** Mint a single-use code (bearer-gated; the `grove pair` CLI calls this). */
  start(): Promise<PairingCodeInfo>;
  /** PUBLIC: exchange a valid, unused, unexpired code for the bearer, exactly once. */
  redeem(input: { code: string }): Promise<PairingGrant>;
}

// router: auth
/**
 * The authenticated user session — distinct from the agent `Session` (db). Auth
 * reuses `gh` / `GH_TOKEN` like the original (spec §3.1); `null` when signed out.
 */
export interface AuthSession {
  readonly userId: string;
  readonly login: string;
  readonly token: string | null;
}

export interface AuthRouter {
  session(): Promise<AuthSession | null>;
  loginGitHub(): Promise<AuthSession>;
  logout(): Promise<Ok>;
}

/**
 * The complete tRPC surface — all 13 routers of architecture §3.1 — that every
 * client builds against for end-to-end type safety.
 */
export interface AppRouter {
  readonly projects: ProjectsRouter;
  readonly workspaces: WorkspacesRouter;
  readonly agents: AgentsRouter;
  readonly sessions: SessionsRouter;
  readonly terminal: TerminalRouter;
  readonly diffs: DiffsRouter;
  readonly presets: PresetsRouter;
  readonly config: ConfigRouter;
  readonly ports: PortsRouter;
  readonly notifications: NotificationsRouter;
  readonly settings: SettingsRouter;
  readonly host: HostRouter;
  readonly pair: PairRouter;
  readonly auth: AuthRouter;
}

/** Events the command mutations append to the sync log. */
export type CommandEvent = DomainEvent;
