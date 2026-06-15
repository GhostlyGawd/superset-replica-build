import { join } from "node:path";
import { BUILTIN_ADAPTERS } from "@swarm/agent-adapters";
import type { Store } from "@swarm/db/store";
import type { HostId } from "@swarm/shared";
import { asId } from "@swarm/shared";
import type { EventLog } from "@swarm/sync";
import { initTRPC } from "@trpc/server";
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
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
