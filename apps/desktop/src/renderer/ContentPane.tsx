import type { Workspace } from "@swarm/db";
import { Badge, EmptyState, Spinner, StatusBadge } from "@swarm/ui/react";
import { LayoutGrid, TerminalSquare } from "lucide-react";
import { ContentTabs } from "./ContentTabs.tsx";
import { type HostState, effectiveStatus } from "./useHost.ts";

interface ContentPaneProps {
  readonly host: HostState;
  readonly selected: Workspace | null;
}

/**
 * The main pane: a connection-aware header plus the Terminal (P05) | Diff (P06)
 * tabbed surface for the selected worktree, both wired to the real host (live PTY
 * stream + real git diff). Every non-connected phase renders a real state, not a
 * crash.
 */
export function ContentPane({ host, selected }: ContentPaneProps) {
  const { phase, liveStatus, client, conn, info } = host;

  return (
    <main data-testid="content-pane" className="flex min-w-0 flex-col bg-base">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        {selected ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg">{selected.name}</span>
            <Badge tone="neutral">{selected.branch}</Badge>
            <StatusBadge status={effectiveStatus(selected, liveStatus)} />
          </div>
        ) : (
          <span className="text-sm text-fg-subtle">No worktree selected</span>
        )}
      </header>

      <div className="min-h-0 flex-1 p-3">
        {phase === "connected" && selected && client && conn ? (
          <ContentTabs client={client} conn={conn} workspace={selected} os={info?.os ?? "linux"} />
        ) : (
          <section className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-line bg-inset">
            {phase === "connecting" ? (
              <div className="flex flex-col items-center gap-2 text-fg-muted">
                <Spinner size="lg" label="Connecting to host" />
                <span className="text-xs">Connecting to host…</span>
              </div>
            ) : phase === "connected" ? (
              <EmptyState
                icon={<LayoutGrid />}
                title="Select a worktree"
                description="Pick a worktree from the rail to inspect its terminal and diff."
              />
            ) : (
              <EmptyState
                icon={<TerminalSquare />}
                title="Not connected"
                description="Connect to a running Grove host to load its worktrees."
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}
