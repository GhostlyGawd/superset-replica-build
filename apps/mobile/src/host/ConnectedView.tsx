import { EmptyState } from "@swarm/ui/react";
import { SquareTerminal } from "lucide-react";
import { SettingsPanel } from "../shell/SettingsPanel.tsx";
import type { TabDef, TabId } from "../shell/tabs.ts";
import { AgentsView } from "./AgentsView.tsx";
import { ConnectionCard } from "./ConnectionCard.tsx";
import { DiffReview } from "./DiffReview.tsx";
import { WorkspaceList } from "./WorkspaceList.tsx";
import type { HostState } from "./useHost.ts";

interface TabBodyProps {
  readonly host: HostState;
  readonly tab: TabDef;
  /** The app's active worktree (resolved), shared across the read journeys. */
  readonly activeWorkspaceId: string | null;
  /** Open a worktree's detail sheet (from the list or an agent row). */
  readonly onOpenWorkspace: (id: string) => void;
  /** Make a worktree the active one (list picker, diff picker). */
  readonly onSetActive: (id: string) => void;
}

/**
 * The live body for the active section once the phone is connected (W3). The read
 * journeys — worktree list + detail, cross-workspace agents, read-only diff — all
 * read from the REAL host. Terminal (W4) stays an honest, non-promissory note.
 */
export function ConnectedTabBody({
  host,
  tab,
  activeWorkspaceId,
  onOpenWorkspace,
  onSetActive,
}: TabBodyProps) {
  if (tab.id === "workspaces") {
    return (
      <WorkspaceList
        workspaces={host.workspaces}
        liveStatus={host.liveStatus}
        activeWorkspaceId={activeWorkspaceId}
        onOpenWorkspace={onOpenWorkspace}
      />
    );
  }

  if (tab.id === "agents") {
    return <AgentsView host={host} onOpenWorkspace={onOpenWorkspace} />;
  }

  if (tab.id === "diff") {
    return (
      <DiffReview host={host} workspaceId={activeWorkspaceId} onSelectWorkspace={onSetActive} />
    );
  }

  if (tab.id === "settings") {
    return (
      <SettingsPanel
        connectionSlot={
          host.info ? (
            <ConnectionCard
              info={host.info}
              syncState={host.syncState}
              onDisconnect={() => void host.disconnect()}
            />
          ) : null
        }
      />
    );
  }

  // Terminal (W4): an honest state — the desktop owns terminals for now.
  return (
    <EmptyState
      icon={<SquareTerminal />}
      title="Terminal"
      description="Open a terminal from the Grove desktop app for now — this phone is paired and live for everything else."
    />
  );
}

/** Whether a tab's body fills the panel (lists/forms) vs. centers an empty state. */
export function tabBodyFills(tabId: TabId): boolean {
  return tabId !== "terminal";
}
