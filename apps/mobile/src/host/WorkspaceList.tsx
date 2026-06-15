import type { Workspace, WorkspaceStatus } from "@swarm/db";
import { Badge, EmptyState, StatusBadge } from "@swarm/ui/react";
import { ChevronRight, FolderGit2, GitBranch } from "lucide-react";

interface WorkspaceListProps {
  readonly workspaces: readonly Workspace[];
  readonly liveStatus: ReadonlyMap<string, WorkspaceStatus>;
  /** The app's active worktree, marked in the list. */
  readonly activeWorkspaceId: string | null;
  /** Tap a row → open that worktree's detail sheet. */
  readonly onOpenWorkspace: (id: string) => void;
}

/**
 * The live worktree list — real `workspaces.list` data with a `/sync` status overlay
 * (W3): each row taps through to the worktree detail (branch, ahead/behind, agents,
 * sessions), and the active worktree is marked. No mocks: an empty host shows an
 * honest empty state, not fabricated rows.
 */
export function WorkspaceList({
  workspaces,
  liveStatus,
  activeWorkspaceId,
  onOpenWorkspace,
}: WorkspaceListProps) {
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
        const isActive = ws.id === activeWorkspaceId;
        return (
          <li key={ws.id}>
            <button
              type="button"
              onClick={() => onOpenWorkspace(ws.id)}
              aria-current={isActive ? "true" : undefined}
              className="flex min-h-[3.25rem] w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-fast ease-standard hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface aria-[current]:border-accent-border aria-[current]:bg-accent-bg"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{ws.name}</span>
                  {isActive ? (
                    <Badge tone="accent" className="shrink-0">
                      Active
                    </Badge>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 truncate text-xs text-fg-muted">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate font-mono">{ws.branch}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge status={status} />
                <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
