import { AgentStatusDot, EmptyState, ErrorState, Spinner, StatusBadge } from "@swarm/ui/react";
import { Bot, ChevronRight } from "lucide-react";
import { type AgentRow, isSessionActive, useAgentRows } from "./host-reads.ts";
import { type HostState, effectiveStatus } from "./useHost.ts";

interface AgentsViewProps {
  readonly host: HostState;
  /** Tap an agent → open its worktree's detail sheet. */
  readonly onOpenWorkspace: (id: string) => void;
}

/** A single cross-workspace agent row, keyed on its session. */
function AgentRowItem({
  row,
  liveStatus,
  onOpen,
}: {
  readonly row: AgentRow;
  readonly liveStatus: ReturnType<typeof effectiveStatus>;
  readonly onOpen: () => void;
}) {
  const { session, workspace } = row;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
      >
        <AgentStatusDot status={liveStatus} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{workspace.name}</span>
            {!isSessionActive(session) ? (
              <span className="shrink-0 text-2xs text-fg-subtle">ended</span>
            ) : null}
          </span>
          <span className="truncate font-mono text-2xs text-fg-subtle">{session.adapterId}</span>
        </span>
        <StatusBadge status={liveStatus} className="shrink-0" />
        <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </button>
    </li>
  );
}

/**
 * The Agents tab (W3): a live, cross-worktree roll-up of every agent session on the
 * host, real-read from `sessions.list` and tinted by the `/sync` status overlay
 * (running / needs-attention / done / error). Tapping a row opens that worktree's
 * detail. When no agent has ever run, an honest empty state — never fabricated rows.
 */
export function AgentsView({ host, onOpenWorkspace }: AgentsViewProps) {
  const result = useAgentRows(host.client, host.workspaces);

  if (result.state === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size="lg" label="Loading agents" />
      </div>
    );
  }
  if (result.state === "error") {
    return (
      <ErrorState
        title="Could not load agents"
        description={result.error}
        className="h-full justify-center"
      />
    );
  }
  if (result.value.length === 0) {
    return (
      <EmptyState
        icon={<Bot />}
        title="No agents running"
        description="Dispatch an agent to a worktree from the Grove desktop app and it shows up here with live status."
        className="h-full justify-center"
      />
    );
  }

  const activeCount = result.value.filter((row) => isSessionActive(row.session)).length;

  return (
    <div className="flex w-full flex-col gap-2 self-start">
      <p className="px-0.5 text-2xs text-fg-subtle">
        {activeCount} running · {result.value.length} total
      </p>
      <ul className="flex flex-col gap-2">
        {result.value.map((row) => (
          <AgentRowItem
            key={row.session.id}
            row={row}
            liveStatus={effectiveStatus(row.workspace, host.liveStatus)}
            onOpen={() => onOpenWorkspace(row.workspace.id)}
          />
        ))}
      </ul>
    </div>
  );
}
