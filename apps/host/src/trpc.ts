import { join } from "node:path";
import { BUILTIN_ADAPTERS } from "@swarm/agent-adapters";
import type { Store } from "@swarm/db/store";
import { WorktreeEngine } from "@swarm/git-worktree";
import type { HostId } from "@swarm/shared";
import { asId } from "@swarm/shared";
import type { EventLog } from "@swarm/sync";
import { TRPCError, initTRPC } from "@trpc/server";
import { z } from "zod";
import type { Orchestrator } from "./orchestrator.ts";

/** OS families the host and clients distinguish (architecture §5). */
export type OsName = "windows" | "macos" | "linux";

export function osName(platform: NodeJS.Platform = process.platform): OsName {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  return "linux";
}

/**
 * Everything the resolvers need, captured once on the host. The tRPC context is
 * just a handle to this — the host is the single writer (architecture §1), so
 * commands route through the orchestrator and queries read the PGlite projections.
 */
export interface HostServices {
  readonly store: Store;
  readonly eventLog: EventLog;
  readonly orchestrator: Orchestrator;
  readonly hostId: HostId;
  readonly version: string;
  readonly os: OsName;
  readonly deviceName: string;
  readonly owner: string;
  /** Resolved loopback endpoint, e.g. `http://127.0.0.1:8787` (known after listen). */
  endpoint(): string;
}

export interface HostContext {
  readonly services: HostServices;
}

const t = initTRPC.context<HostContext>().create();

const workspaceIdInput = z.object({ workspaceId: z.string() });

/** Resolve a workspace's on-disk worktree path, or 404 — the diff router's anchor. */
async function worktreePathFor(services: HostServices, workspaceId: string): Promise<string> {
  const workspace = await services.store.getWorkspace(asId<"WorkspaceId">(workspaceId));
  if (!workspace) {
    throw new TRPCError({ code: "NOT_FOUND", message: `unknown workspace: ${workspaceId}` });
  }
  return workspace.worktreePath;
}

/** Surface a git-worktree `Result` error as a tRPC error instead of a silent value. */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error.message });
  }
  return result.value;
}

/**
 * A focused, real slice of the architecture §3.1 surface — enough to drive the
 * orchestration command path (create worktree → start agent → stop) and read the
 * materialized projections that the parallel-agents proof asserts on. The full
 * 13-router contract (`@swarm/api`) layers onto the same context.
 */
export function createAppRouter() {
  return t.router({
    host: t.router({
      status: t.procedure.query(({ ctx }) => {
        const s = ctx.services;
        return {
          hostId: s.hostId,
          version: s.version,
          os: s.os,
          online: true as const,
          boundTo: s.endpoint(),
        };
      }),
      info: t.procedure.query(({ ctx }) => {
        const s = ctx.services;
        return {
          hostId: s.hostId,
          deviceName: s.deviceName,
          os: s.os,
          endpoint: s.endpoint(),
          online: true as const,
          lastSeenAt: new Date().toISOString(),
          owner: s.owner,
        };
      }),
    }),

    agents: t.router({
      listAdapters: t.procedure.query(() => BUILTIN_ADAPTERS),
      start: t.procedure
        .input(
          z.object({
            workspaceId: z.string(),
            /**
             * Which adapter to dispatch — a real built-in preset, or the keyless
             * `mock` (which still only runs when `SWARM_ENABLE_MOCK_ADAPTER` is set
             * on the host; there is no API field to enable it, so it is never on a
             * user happy path). Required: no default selection.
             */
            adapterId: z.enum([
              "claude-code",
              "codex-cli",
              "cursor-agent",
              "gemini-cli",
              "generic",
              "mock",
            ]),
            /** Command for the `generic` adapter (or an override for a named CLI). */
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            workMs: z.number().int().positive().optional(),
            fileName: z.string().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const run = await ctx.services.orchestrator.startAgentInWorkspace(
            asId<"WorkspaceId">(input.workspaceId),
            {
              adapterId: input.adapterId,
              command: input.command,
              args: input.args,
              workMs: input.workMs,
              fileName: input.fileName,
            },
          );
          return run.session;
        }),
      stop: t.procedure
        .input(z.object({ sessionId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          await ctx.services.orchestrator.stopAgent(asId<"SessionId">(input.sessionId));
          return { ok: true as const };
        }),
    }),

    workspaces: t.router({
      list: t.procedure
        .input(z.object({ projectId: z.string().optional() }).optional())
        .query(({ ctx, input }) =>
          ctx.services.store.listWorkspaces(
            input?.projectId ? asId<"ProjectId">(input.projectId) : undefined,
          ),
        ),
      get: t.procedure
        .input(workspaceIdInput)
        .query(({ ctx, input }) =>
          ctx.services.store.getWorkspace(asId<"WorkspaceId">(input.workspaceId)),
        ),
      create: t.procedure
        .input(
          z.object({
            projectId: z.string(),
            name: z.string(),
            branch: z.string(),
            baseBranch: z.string().optional(),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          const project = await ctx.services.store.getProject(asId<"ProjectId">(input.projectId));
          if (!project) {
            throw new Error(`unknown project: ${input.projectId}`);
          }
          const prepared = await ctx.services.orchestrator.createWorkspace({
            project,
            name: input.name,
            branch: input.branch,
            baseBranch: input.baseBranch,
            worktreesDir: join(ctx.services.orchestrator.worktreesRoot, input.projectId),
          });
          return prepared.workspace;
        }),
    }),

    sessions: t.router({
      list: t.procedure
        .input(workspaceIdInput)
        .query(({ ctx, input }) =>
          ctx.services.store.listSessions(asId<"WorkspaceId">(input.workspaceId)),
        ),
    }),

    /**
     * Real git diff over a workspace's worktree (P06). `status`/`getFileDiff` read
     * the live working tree vs HEAD; `writeFile` saves the inline editor's content
     * straight back to disk; `discard` restores a file. High-frequency terminal IO
     * does NOT live here — it rides the ephemeral `/terminal` WS topic (spec §4).
     */
    diffs: t.router({
      status: t.procedure.input(workspaceIdInput).query(async ({ ctx, input }) => {
        const path = await worktreePathFor(ctx.services, input.workspaceId);
        return unwrap(await new WorktreeEngine(path).changes(path));
      }),
      getFileDiff: t.procedure
        .input(z.object({ workspaceId: z.string(), path: z.string() }))
        .query(async ({ ctx, input }) => {
          const path = await worktreePathFor(ctx.services, input.workspaceId);
          return unwrap(await new WorktreeEngine(path).fileDiff(path, input.path));
        }),
      writeFile: t.procedure
        .input(z.object({ workspaceId: z.string(), path: z.string(), content: z.string() }))
        .mutation(async ({ ctx, input }) => {
          const path = await worktreePathFor(ctx.services, input.workspaceId);
          unwrap(await new WorktreeEngine(path).writeFile(path, input.path, input.content));
          return { ok: true as const };
        }),
      discard: t.procedure
        .input(z.object({ workspaceId: z.string(), path: z.string() }))
        .mutation(async ({ ctx, input }) => {
          const path = await worktreePathFor(ctx.services, input.workspaceId);
          unwrap(await new WorktreeEngine(path).discardFile(path, input.path));
          return { ok: true as const };
        }),
    }),

    /**
     * Terminal discovery (P05). The actual byte stream is out-of-band on the
     * `/terminal` WebSocket topic (see `terminal-server.ts`); this router only
     * advertises the worktree's cwd + the default shell a new session should use.
     */
    terminal: t.router({
      shellFor: t.procedure.input(workspaceIdInput).query(async ({ ctx, input }) => {
        const cwd = await worktreePathFor(ctx.services, input.workspaceId);
        return { cwd, defaultShell: defaultShellFor(ctx.services.os) };
      }),
    }),
  });
}

/** The reliably-present default interactive shell per OS for a fresh terminal. */
export function defaultShellFor(os: OsName): string {
  return os === "windows" ? "powershell" : "bash";
}

export type AppRouter = ReturnType<typeof createAppRouter>;
