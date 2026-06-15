import type { Workspace, WorkspaceStatus } from "@swarm/db";
import { EmptyState, StatusBadge } from "@swarm/ui/react";
import { FolderGit2, GitBranch } from "lucide-react";

interface WorkspaceListProps {
  readonly workspaces: readonly Workspace[];
  readonly liveStatus: ReadonlyMap<string, WorkspaceStatus>;
}

/**
 * The live worktree list — real `workspaces.list` data with a `/sync` status overlay
 * (W2 goes LIVE; switch + per-worktree detail land in W3). No mocks: an empty host
 * shows an honest empty state, not fabricated rows.
 */
export function WorkspaceList({ workspaces, liveStatus }: WorkspaceListProps) {
  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 />}
        title="No worktrees yet"
        description="Create one from the Grove desktop app or the `grove` CLI and it appears here."
      />
    );
  }

  return (
    <ul className="flex w-full flex-col gap-2 self-start">
      {workspaces.map((ws) => {
        const status = liveStatus.get(ws.id) ?? ws.status;
        return (
          <li
            key={ws.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-fg">{ws.name}</span>
              <span className="flex items-center gap-1 truncate text-xs text-fg-muted">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate font-mono">{ws.branch}</span>
              </span>
            </div>
            <StatusBadge status={status} className="shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}
