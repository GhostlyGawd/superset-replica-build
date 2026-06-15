import type { Session, Workspace } from "@swarm/db";
import { useEffect, useState } from "react";
import type { HostTrpcClient } from "./host-client.ts";

/**
 * Wire shapes for the phone's read journeys (W3), derived from the tRPC client so
 * the Node-only `@swarm/git-worktree` package is NEVER imported into the browser
 * bundle (the router type is erased at build, exactly as the desktop DiffPanel does).
 */
export type FileChange = Awaited<ReturnType<HostTrpcClient["diffs"]["status"]["query"]>>[number];
export type FileDiff = Awaited<ReturnType<HostTrpcClient["diffs"]["getFileDiff"]["query"]>>;
export type GitStatus = Awaited<ReturnType<HostTrpcClient["workspaces"]["gitStatus"]["query"]>>;

/** One agent session bound to the worktree it runs in — the Agents-tab row model. */
export interface AgentRow {
  readonly session: Session;
  readonly workspace: Workspace;
}

/** Treat a session's lifecycle string as "still live" (running, not yet ended). */
export function isSessionActive(session: Session): boolean {
  return session.endedAt === null && session.status !== "exited" && session.status !== "error";
}

export type Async<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "error"; readonly error: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The live working-tree status for one worktree (`workspaces.gitStatus`). Errors
 * (e.g. a worktree path that is not a git checkout) resolve to an `error` state the
 * detail view renders calmly, never a crash.
 */
export function useGitStatus(
  client: HostTrpcClient | null,
  workspaceId: string | null,
): Async<GitStatus> {
  const [result, setResult] = useState<Async<GitStatus>>({ state: "loading" });

  useEffect(() => {
    if (!client || !workspaceId) {
      return;
    }
    let cancelled = false;
    setResult({ state: "loading" });
    void (async () => {
      try {
        const value = await client.workspaces.gitStatus.query({ workspaceId });
        if (!cancelled) {
          setResult({ state: "ready", value });
        }
      } catch (err) {
        if (!cancelled) {
          setResult({ state: "error", error: errorText(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId]);

  return result;
}

/** The agent sessions of one worktree (`sessions.list`), with loading/error state. */
export function useSessions(
  client: HostTrpcClient | null,
  workspaceId: string | null,
): Async<readonly Session[]> {
  const [result, setResult] = useState<Async<readonly Session[]>>({ state: "loading" });

  useEffect(() => {
    if (!client || !workspaceId) {
      return;
    }
    let cancelled = false;
    setResult({ state: "loading" });
    void (async () => {
      try {
        const value = await client.sessions.list.query({ workspaceId });
        if (!cancelled) {
          setResult({ state: "ready", value });
        }
      } catch (err) {
        if (!cancelled) {
          setResult({ state: "error", error: errorText(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId]);

  return result;
}

/**
 * The cross-workspace agent view (Agents tab): fan `sessions.list` across every
 * worktree and flatten to per-session rows, newest first. A live workspace status
 * overlay folds in at the call site; this just supplies the real session inventory.
 */
export function useAgentRows(
  client: HostTrpcClient | null,
  workspaces: readonly Workspace[],
): Async<readonly AgentRow[]> {
  const [result, setResult] = useState<Async<readonly AgentRow[]>>({ state: "loading" });
  // A stable key so the effect refetches only when the set of worktrees changes,
  // not on every overlay-driven re-render of the parent.
  const key = workspaces.map((ws) => ws.id).join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for the workspace identity set; the body reads `workspaces` fresh.
  useEffect(() => {
    if (!client) {
      return;
    }
    let cancelled = false;
    setResult({ state: "loading" });
    void (async () => {
      try {
        const lists = await Promise.all(
          workspaces.map(async (ws) => {
            const sessions = await client.sessions.list.query({ workspaceId: ws.id });
            return sessions.map((session) => ({ session, workspace: ws }));
          }),
        );
        if (cancelled) {
          return;
        }
        const rows = lists
          .flat()
          .sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt));
        setResult({ state: "ready", value: rows });
      } catch (err) {
        if (!cancelled) {
          setResult({ state: "error", error: errorText(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, key]);

  return result;
}
