import type { AdapterDescriptor } from "@swarm/agent-adapters";
import type { SwarmConfig } from "@swarm/config";
import type { DomainEvent } from "@swarm/core-engine";
import type { AgentPreset, Project, Session, Workspace } from "@swarm/db";
import type { FileChange, FileDiff } from "@swarm/git-worktree";
import type { ProjectId, PtyId, SessionId, WorkspaceId } from "@swarm/shared";

/**
 * @swarm/api — the tRPC router surface (spec §3.1) expressed as interfaces.
 * Mutations are commands that append `DomainEvent`s; queries read materialized
 * state. Clients import `AppRouter` for end-to-end type safety; the Hono +
 * tRPC runtime binds to these shapes in Phase 2.
 */

export const API_VERSION = "0.1.0";

export interface Ok {
  readonly ok: true;
}

export interface ProjectsRouter {
  list(): Promise<readonly Project[]>;
  create(input: {
    name: string;
    repoUrl?: string;
    localPath?: string;
    clone?: boolean;
  }): Promise<Project>;
  get(input: { projectId: ProjectId }): Promise<Project>;
  remove(input: { projectId: ProjectId }): Promise<Ok>;
}

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
}

export interface AgentsRouter {
  listAdapters(): Promise<readonly AdapterDescriptor[]>;
  listPresets(): Promise<readonly AgentPreset[]>;
  start(input: { workspaceId: WorkspaceId; presetId: string; prompt?: string }): Promise<Session>;
  stop(input: { sessionId: SessionId }): Promise<Ok>;
}

export interface TerminalRouter {
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
}

export interface DiffsRouter {
  status(input: { workspaceId: WorkspaceId }): Promise<readonly FileChange[]>;
  getFileDiff(input: { workspaceId: WorkspaceId; path: string }): Promise<FileDiff>;
  writeFile(input: { workspaceId: WorkspaceId; path: string; content: string }): Promise<Ok>;
}

export interface ConfigRouter {
  read(input: { projectId: ProjectId }): Promise<SwarmConfig>;
}

/** The full tRPC surface every client builds against (spec §3.1). */
export interface AppRouter {
  readonly projects: ProjectsRouter;
  readonly workspaces: WorkspacesRouter;
  readonly agents: AgentsRouter;
  readonly terminal: TerminalRouter;
  readonly diffs: DiffsRouter;
  readonly config: ConfigRouter;
}

/** Events the command mutations append to the sync log. */
export type CommandEvent = DomainEvent;
