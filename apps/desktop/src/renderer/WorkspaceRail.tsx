import {
  AgentStatusDot,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  ListRow,
  Skeleton,
  Tooltip,
} from "@swarm/ui/react";
import { Boxes, FolderGit2, Plus, RefreshCw, Search, Unplug } from "lucide-react";
import { type HostState, effectiveStatus } from "./useHost.ts";

interface WorkspaceRailProps {
  readonly host: HostState;
  readonly filter: string;
  readonly onFilter: (value: string) => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onNewWorkspace: () => void;
  readonly onOpenProject: () => void;
  /** False when no project is loaded yet (new-worktree needs one). */
  readonly canCreate: boolean;
}

const RETRY_ICON = <RefreshCw className="size-3.5" aria-hidden />;

/** The left rail: filterable, selectable list of worktrees with real per-phase
 *  empty / loading / error states (never a blank panel). */
export function WorkspaceRail({
  host,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onNewWorkspace,
  onOpenProject,
  canCreate,
}: WorkspaceRailProps) {
  const { phase, workspaces, liveStatus } = host;
  const connected = phase === "connected";
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? workspaces.filter(
        (ws) => ws.name.toLowerCase().includes(needle) || ws.branch.toLowerCase().includes(needle),
      )
    : workspaces;

  return (
    <aside
      aria-label="Workspaces"
      data-testid="workspace-rail"
      className="flex min-h-0 w-64 shrink-0 flex-col border-r border-line bg-surface"
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-2 pl-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <Boxes className="size-4 shrink-0 text-accent-fg" aria-hidden />
          Worktrees
          {connected ? <Badge tone="neutral">{workspaces.length}</Badge> : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <Tooltip label="Open project…">
            <IconButton
              size="sm"
              aria-label="Open project"
              onClick={onOpenProject}
              disabled={!connected}
            >
              <FolderGit2 />
            </IconButton>
          </Tooltip>
          <Tooltip label={canCreate ? "New worktree…" : "Open a project first"}>
            <IconButton
              size="sm"
              aria-label="New worktree"
              onClick={onNewWorkspace}
              disabled={!connected || !canCreate}
            >
              <Plus />
            </IconButton>
          </Tooltip>
        </span>
      </header>

      <div className="shrink-0 p-2">
        <Input
          aria-label="Filter worktrees"
          value={filter}
          onChange={(event) => onFilter(event.currentTarget.value)}
          leadingIcon={<Search />}
          disabled={phase !== "connected"}
        />
      </div>

      {phase === "connecting" ? (
        <div className="flex flex-col gap-1.5 p-2" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ) : null}

      {phase === "no-host" ? (
        <div data-testid="connect-state" className="flex min-h-0 flex-1 items-center">
          <EmptyState
            icon={<Unplug />}
            title="No host running"
            description="The Grove host engine isn't reachable on this machine yet."
            action={
              <Button variant="secondary" size="sm" icon={RETRY_ICON} onClick={host.retry}>
                Retry connection
              </Button>
            }
            hint={
              <span>
                Start it with <code className="font-mono text-fg-muted">grove host</code>
              </span>
            }
          />
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="flex min-h-0 flex-1 items-center">
          <ErrorState
            title="Can't reach the host"
            description="The host was configured but the connection failed."
            detail={host.error ?? undefined}
            action={
              <Button variant="secondary" size="sm" icon={RETRY_ICON} onClick={host.retry}>
                Retry
              </Button>
            }
          />
        </div>
      ) : null}

      {phase === "connected" ? (
        <nav
          aria-label="Worktree list"
          className="flex min-h-0 flex-1 flex-col overflow-auto p-1.5"
        >
          {workspaces.length === 0 ? (
            <div className="flex flex-1 items-center">
              <EmptyState
                icon={<Boxes />}
                title="No worktrees yet"
                description="This host has no worktrees. Create one from the CLI to get started."
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-1 items-center">
              <EmptyState
                icon={<Search />}
                title="No matches"
                description={`Nothing matches “${filter}”.`}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {visible.map((ws) => (
                <ListRow
                  key={ws.id}
                  selected={selectedId === ws.id}
                  onSelect={() => onSelect(ws.id)}
                  leading={<AgentStatusDot status={effectiveStatus(ws, liveStatus)} />}
                  trailing={
                    <span className="max-w-24 truncate font-mono text-2xs text-fg-subtle">
                      {ws.branch}
                    </span>
                  }
                >
                  {ws.name}
                </ListRow>
              ))}
            </div>
          )}
        </nav>
      ) : null}
    </aside>
  );
}
