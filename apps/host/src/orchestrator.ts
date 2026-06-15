import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AdapterId,
  type AgentStatus,
  MOCK_ADAPTER_ENABLED_ENV,
  getPreset,
  isMockAdapterEnabled,
  launchMockAgent,
  launchTerminalAdapter,
  resolveExecutable,
} from "@swarm/agent-adapters";
import type { SwarmConfig } from "@swarm/config";
import type { Project, Session, Workspace } from "@swarm/db";
import type { Store } from "@swarm/db/store";
import { WorktreeEngine } from "@swarm/git-worktree";
import type { PtySupervisor, ShellKind } from "@swarm/pty-supervisor";
import { toPosixPath } from "@swarm/shared";
import type { SessionId, WorkspaceId } from "@swarm/shared";
import type { EventLog } from "@swarm/sync";
import { loadWorkspaceConfig, runLifecyclePhase } from "./lifecycle.ts";

/**
 * The host-side orchestration engine (P01 + P02 + P03 + P07). Given a project repo
 * and an agent selection it: cuts an isolated git worktree (branch-per-task) via
 * {@link WorktreeEngine}, runs the workspace `setup` lifecycle commands, launches
 * the chosen adapter on a real PTY (Node, ADR-0007a), maps the adapter's status
 * stream into {@link DomainEvent}s, appends them to the durable {@link EventLog}
 * (PGlite-backed), keeps the `workspaces`/`sessions` projections in step, and runs
 * `teardown` after the session ends. Platform-touching, so it lives in `apps/host`
 * rather than the Node-free `core-engine`.
 *
 * Adapter dispatch is explicit: a caller selects a real preset
 * (`claude-code | codex-cli | cursor-agent | gemini-cli | generic`, the last with
 * an explicit command) and it is launched over the universal terminal adapter. The
 * keyless `mock` adapter is reachable ONLY when selected AND a test/dev flag is set
 * (`SWARM_ENABLE_MOCK_ADAPTER` or an explicit `enableMock:true`); there is no
 * default that puts the mock on a user happy path (RUBRIC §6.1).
 */

/** What to dispatch: a real built-in adapter id, or the keyless `mock` (gated). */
export type AgentSelection = AdapterId | "mock";
export interface OrchestratorDeps {
  readonly store: Store;
  readonly eventLog: EventLog;
  readonly supervisor: PtySupervisor;
  /** Base directory for worktrees created via the API (default `~/.grove/worktrees`). */
  readonly worktreesRoot?: string;
}

export interface CreateWorkspaceInput {
  readonly project: Project;
  readonly name: string;
  readonly branch: string;
  readonly baseBranch?: string;
  /** Base directory under which the per-task worktree directory is created. */
  readonly worktreesDir: string;
}

export interface PreparedWorkspace {
  readonly workspace: Workspace;
  /** OS-native worktree path (for PTY cwd). */
  readonly worktreePathOs: string;
  /** POSIX-normalized worktree path (as stored, spec §5). */
  readonly worktreePath: string;
}

export interface StartAgentOptions {
  /**
   * Which adapter to dispatch. Required — there is no default, so the mock can
   * never run implicitly. `generic` also needs {@link StartAgentOptions.command}.
   */
  readonly adapterId?: AgentSelection;
  /** Command for the `generic` adapter (or an override for a named preset's CLI). */
  readonly command?: string;
  /** Args for the `generic` adapter / preset command. */
  readonly args?: readonly string[];
  readonly shell?: ShellKind;
  /** Length of the simulated working phase in ms (mock adapter). */
  readonly workMs?: number;
  /** File the agent writes into its worktree (mock adapter default filename). */
  readonly fileName?: string;
  /** Explicit opt-in for the keyless mock adapter (tests/dev only). */
  readonly enableMock?: boolean;
}

export interface AgentRun {
  readonly workspace: Workspace;
  readonly session: Session;
  readonly worktreePath: string;
  readonly branch: string;
  /** The dispatched adapter (`mock` or a real preset id). */
  readonly adapterId: AgentSelection;
  /** Absolute (POSIX) file the mock agent writes — for the diff viewer/tests. Real
   *  adapters write whatever they write, so this is undefined for them. */
  readonly outputFile?: string;
  /** Resolves once the agent reaches a terminal state and its events are persisted. */
  readonly done: Promise<{ readonly status: AgentStatus; readonly exitCode: number }>;
  /** Terminate the agent's PTY process tree. Idempotent. */
  stop(): Promise<void>;
}

interface RunContext {
  readonly workspace: Workspace;
  readonly session: Session;
  /** Worktree (OS-native path) — lifecycle commands run here. */
  readonly cwdOs: string;
  /** Project repo root (for lifecycle env + config), if known. */
  readonly repoRoot: string;
  /** Validated workspace config (P07), or null when there is none. */
  readonly config: SwarmConfig | null;
  chain: Promise<void>;
  startedEmitted: boolean;
  finished: boolean;
  /** Authoritative exit code from node-pty's exit event, once the agent process exits. */
  exitCode: number | undefined;
  resolveDone: (value: { status: AgentStatus; exitCode: number }) => void;
}

/** A resolved launch plan: the keyless mock, or a real CLI over the terminal adapter. */
type LaunchPlan =
  | { readonly kind: "mock"; readonly selection: AgentSelection }
  | {
      readonly kind: "real";
      readonly selection: AgentSelection;
      readonly command: string;
      readonly args: readonly string[];
      readonly detection: ReturnType<typeof getPreset>["detection"];
      readonly env: Readonly<Record<string, string>>;
    };

function slugify(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

export class Orchestrator {
  private readonly store: Store;
  private readonly eventLog: EventLog;
  private readonly supervisor: PtySupervisor;
  private readonly engines = new Map<string, WorktreeEngine>();
  private readonly runs = new Map<SessionId, AgentRun>();
  readonly worktreesRoot: string;

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store;
    this.eventLog = deps.eventLog;
    this.supervisor = deps.supervisor;
    this.worktreesRoot = deps.worktreesRoot ?? join(homedir(), ".grove", "worktrees");
  }

  private engineFor(repoRoot: string): WorktreeEngine {
    let engine = this.engines.get(repoRoot);
    if (engine === undefined) {
      engine = new WorktreeEngine(repoRoot);
      this.engines.set(repoRoot, engine);
    }
    return engine;
  }

  /**
   * Cut an isolated worktree + branch for a task and record the workspace.
   * Worktree creation is serialized by the caller (git locks `.git/worktrees`);
   * this is the P02 isolation primitive, not the parallel hot path.
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<PreparedWorkspace> {
    const repoRoot = input.project.localPath;
    if (!repoRoot) {
      throw new Error(`project ${input.project.id} has no local repo path to cut a worktree from`);
    }
    const baseBranch = input.baseBranch ?? input.project.defaultBranch ?? "main";
    const worktreePathOs = join(input.worktreesDir, slugify(input.name));

    const workspace = await this.store.createWorkspace({
      projectId: input.project.id,
      name: input.name,
      branch: input.branch,
      baseBranch,
      worktreePath: toPosixPath(worktreePathOs),
      status: "idle",
    });

    const created = await this.engineFor(repoRoot).create({
      workspaceId: workspace.id,
      branch: input.branch,
      baseBranch,
      path: worktreePathOs,
    });
    if (!created.ok) {
      await this.store.setWorkspaceStatus(workspace.id, "error");
      throw new Error(
        `worktree create failed for ${input.name} (${created.error.code}): ${created.error.message}`,
      );
    }

    await this.eventLog.append({
      type: "workspace.created",
      workspaceId: workspace.id,
      name: input.name,
    });

    return { workspace, worktreePathOs, worktreePath: created.value.path };
  }

  /**
   * Launch the agent in a prepared worktree on a real PTY and wire its status
   * stream to durable events. Returns immediately; `done` resolves when the agent
   * terminates. Launching many of these without awaiting `done` is exactly the
   * P01 parallel path — each runs in its own PTY + worktree.
   */
  startAgent(prepared: PreparedWorkspace, options: StartAgentOptions = {}): Promise<AgentRun> {
    return this.launch(prepared.workspace, prepared.worktreePathOs, options);
  }

  /** Convenience: prepare a worktree then start the agent in one call. */
  async spawnAgent(input: CreateWorkspaceInput & StartAgentOptions): Promise<AgentRun> {
    const prepared = await this.createWorkspace(input);
    return this.startAgent(prepared, input);
  }

  /** Start an agent in a workspace that already exists (the `agents.start` command). */
  async startAgentInWorkspace(
    workspaceId: WorkspaceId,
    options: StartAgentOptions = {},
  ): Promise<AgentRun> {
    const workspace = await this.store.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`unknown workspace: ${workspaceId}`);
    }
    const cwdOs =
      process.platform === "win32"
        ? workspace.worktreePath.replace(/\//g, "\\")
        : workspace.worktreePath;
    return this.launch(workspace, cwdOs, options);
  }

  /** Tree-kill a running agent's PTY by session id (the `agents.stop` command). */
  async stopAgent(sessionId: SessionId): Promise<void> {
    const run = this.runs.get(sessionId);
    if (run) {
      await run.stop();
    }
  }

  /**
   * Stop everything this orchestrator owns: tree-kill every live PTY/agent process
   * tree via the supervisor so no node-pty pipe keeps the event loop alive after the
   * host closes (the Windows teardown hang). Idempotent; safe when nothing is running.
   */
  async shutdown(): Promise<void> {
    await this.supervisor.killAll();
    this.runs.clear();
  }

  /**
   * Validate + resolve the requested adapter BEFORE any DB write. An absent
   * selection, a disabled mock, or a `generic` adapter without a command all
   * throw here, so no orphan session is created and the mock never runs implicitly.
   */
  private resolveLaunchPlan(options: StartAgentOptions): LaunchPlan {
    const selection = options.adapterId;
    if (selection === undefined) {
      throw new Error(
        "startAgent requires an adapterId (claude-code | codex-cli | cursor-agent | gemini-cli | generic | mock)",
      );
    }
    if (selection === "mock") {
      if (!isMockAdapterEnabled(options.enableMock)) {
        throw new Error(
          `mock adapter is disabled; choose a real adapter, or set ${MOCK_ADAPTER_ENABLED_ENV}=1 / enableMock:true (test/dev only)`,
        );
      }
      return { kind: "mock", selection };
    }
    const preset = getPreset(selection); // throws on an unknown id
    let command = preset.descriptor.command;
    let args: readonly string[] = preset.descriptor.argsTemplate;
    const explicit = options.command?.trim();
    if (preset.descriptor.generic) {
      if (!explicit) {
        throw new Error(`adapter "${selection}" requires an explicit command (options.command)`);
      }
      command = explicit;
      args = options.args ?? [];
    } else if (explicit) {
      command = explicit; // custom install path / wrapper for a named CLI
      args = options.args ?? args;
    }
    return { kind: "real", selection, command, args, detection: preset.detection, env: preset.env };
  }

  /** The project's local repo root, used to load `.grove/config.json` (P07). */
  private async repoRootFor(workspace: Workspace): Promise<string | null> {
    const project = await this.store.getProject(workspace.projectId);
    return project?.localPath ?? null;
  }

  private async launch(
    workspace: Workspace,
    cwdOs: string,
    options: StartAgentOptions,
  ): Promise<AgentRun> {
    const plan = this.resolveLaunchPlan(options);

    const session = await this.store.createSession({
      workspaceId: workspace.id,
      adapterId: plan.selection,
      mode: "terminal",
      status: "starting",
    });

    let resolveDone!: (value: { status: AgentStatus; exitCode: number }) => void;
    const done = new Promise<{ status: AgentStatus; exitCode: number }>((resolve) => {
      resolveDone = resolve;
    });

    const repoRoot = await this.repoRootFor(workspace);
    const config = repoRoot ? loadWorkspaceConfig(repoRoot) : null;

    const ctx: RunContext = {
      workspace,
      session,
      cwdOs,
      repoRoot: repoRoot ?? cwdOs,
      config,
      chain: Promise.resolve(),
      startedEmitted: false,
      finished: false,
      exitCode: undefined,
      resolveDone,
    };

    // P07: workspace `setup` runs to completion BEFORE the agent launches, so a
    // marker it writes is already present when the agent's session starts.
    if (config && config.setup.length > 0) {
      await runLifecyclePhase({
        supervisor: this.supervisor,
        workspaceId: workspace.id,
        cwd: cwdOs,
        repoRoot: ctx.repoRoot,
        workspaceName: workspace.name,
        phase: "setup",
        commands: config.setup,
        append: (event) => this.eventLog.append(event),
      });
    }

    // Both `launchMockAgent` and `launchTerminalAdapter` fire onStatus("running")
    // synchronously during launch, so the context above is fully built first. The
    // exit code is taken from node-pty's exit event (onExit), the authoritative
    // source — recorded here and used when the done/error status is persisted.
    let handle: { stop(): Promise<void> };
    let outputFile: string | undefined;
    if (plan.kind === "mock") {
      const mock = launchMockAgent({
        supervisor: this.supervisor,
        workspaceId: workspace.id,
        cwd: cwdOs,
        shell: options.shell,
        enable: options.enableMock,
        workMs: options.workMs,
        fileName: options.fileName,
        onStatus: (status) => this.onStatus(ctx, status),
        onExit: (exit) => {
          ctx.exitCode = exit.exitCode;
        },
      });
      handle = mock;
      outputFile = mock.outputFile;
    } else {
      // Resolve the command to a concrete executable path before the DIRECT spawn.
      // node-pty's ConPTY `startProcess` requires an executable that resolves WITH
      // its extension (it does not apply PATHEXT), so a bare name like `node` or a
      // named preset's `claude` must be resolved to `node.exe` / `claude.cmd` first.
      // `resolveExecutable` (where.exe/which, PATHEXT-aware, run under Node) returns
      // the real file; a bare `node` resolves to `process.execPath` with no PATH
      // lookup; the adapter then runs a `.cmd`/`.bat` shim via cmd.exe.
      // NEVER hand node-pty an empty `file`: `resolveExecutable` returns `undefined`
      // (or, defensively, could yield a blank) when nothing resolved — fall back to the
      // original command and let CreateProcess attempt it, rather than spawning "".
      const resolved = await resolveExecutable(plan.command);
      const command = resolved && resolved.trim().length > 0 ? resolved : plan.command;
      handle = launchTerminalAdapter({
        supervisor: this.supervisor,
        workspaceId: workspace.id,
        command,
        args: plan.args,
        cwd: cwdOs,
        shell: options.shell,
        detection: plan.detection,
        env: plan.env,
        onStatus: (status) => this.onStatus(ctx, status),
        onExit: (exit) => {
          ctx.exitCode = exit.exitCode;
        },
      });
    }

    const run: AgentRun = {
      workspace,
      session,
      worktreePath: toPosixPath(cwdOs),
      branch: workspace.branch,
      adapterId: plan.selection,
      outputFile,
      done,
      stop: () => handle.stop(),
    };
    this.runs.set(session.id, run);
    void done.finally(() => this.runs.delete(session.id));
    return run;
  }

  /** P07: run `teardown` after a session ends (best-effort), streaming its output. */
  private async runTeardown(ctx: RunContext): Promise<void> {
    if (!ctx.config || ctx.config.teardown.length === 0) {
      return;
    }
    await runLifecyclePhase({
      supervisor: this.supervisor,
      workspaceId: ctx.workspace.id,
      cwd: ctx.cwdOs,
      repoRoot: ctx.repoRoot,
      workspaceName: ctx.workspace.name,
      phase: "teardown",
      commands: ctx.config.teardown,
      append: (event) => this.eventLog.append(event),
    });
  }

  /** Map one adapter status into projection updates + durable domain events. */
  private onStatus(ctx: RunContext, status: AgentStatus): void {
    if (status === "running" && !ctx.startedEmitted) {
      ctx.startedEmitted = true;
      ctx.chain = ctx.chain
        .then(() =>
          this.eventLog.append({
            type: "session.started",
            sessionId: ctx.session.id,
            workspaceId: ctx.workspace.id,
          }),
        )
        .then(() => this.store.setWorkspaceStatus(ctx.workspace.id, "running"))
        .then(() =>
          this.eventLog.append({
            type: "workspace.status_changed",
            workspaceId: ctx.workspace.id,
            status: "running",
          }),
        )
        .then(() => undefined);
      return;
    }

    if (status === "needs_attention" && !ctx.finished) {
      ctx.chain = ctx.chain
        .then(() => this.store.setWorkspaceStatus(ctx.workspace.id, "needs_attention"))
        .then(() =>
          this.eventLog.append({
            type: "workspace.status_changed",
            workspaceId: ctx.workspace.id,
            status: "needs_attention",
          }),
        )
        .then(() => undefined);
      return;
    }

    if ((status === "done" || status === "error") && !ctx.finished) {
      ctx.finished = true;
      // Prefer node-pty's authoritative exit code; fall back to the status mapping
      // (e.g. when `done` was inferred from a mid-run done pattern before the exit
      // event arrived, or for the mock whose terminal state can precede its exit).
      const exitCode = ctx.exitCode ?? (status === "done" ? 0 : 1);
      ctx.chain = ctx.chain
        .then(() => this.store.setWorkspaceStatus(ctx.workspace.id, status))
        .then(() =>
          this.eventLog.append({
            type: "workspace.status_changed",
            workspaceId: ctx.workspace.id,
            status,
          }),
        )
        .then(() => this.store.endSession(ctx.session.id, exitCode, status))
        .then(() =>
          this.eventLog.append({
            type: "session.exited",
            sessionId: ctx.session.id,
            exitCode,
          }),
        )
        // P07: teardown runs AFTER the session has ended; `done` resolves only once
        // teardown completes, so callers can assert its effects deterministically.
        .then(() => this.runTeardown(ctx))
        .then(() => {
          ctx.resolveDone({ status, exitCode });
        });
    }
  }
}
