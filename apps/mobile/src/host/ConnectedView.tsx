import { SettingsPanel } from "../shell/SettingsPanel.tsx";
import type { TabDef, TabId } from "../shell/tabs.ts";
import { AgentsView } from "./AgentsView.tsx";
import { ConnectionCard } from "./ConnectionCard.tsx";
import { DiffReview } from "./DiffReview.tsx";
import { NotificationsCard } from "./NotificationsCard.tsx";
import { WorkspaceList } from "./WorkspaceList.tsx";
import { TerminalView } from "./terminal/TerminalView.tsx";
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
  /** Bumped after a dispatch so the Agents roll-up refetches its live sessions. */
  readonly dispatchNonce: number;
}

/**
 * The live body for the active section once the phone is connected. The read journeys
 * (worktree list + detail, cross-workspace agents, read-only diff) and the W4 write
 * journeys (touch terminal over the `/terminal` WS, dispatch) all run on the REAL host.
 */
export function ConnectedTabBody({
  host,
  tab,
  activeWorkspaceId,
  onOpenWorkspace,
  onSetActive,
  dispatchNonce,
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
    // Remount on dispatch so a freshly started agent appears without a manual refresh.
    return <AgentsView key={dispatchNonce} host={host} onOpenWorkspace={onOpenWorkspace} />;
  }

  if (tab.id === "terminal") {
    return <TerminalView host={host} workspaceId={activeWorkspaceId} />;
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
        notificationsSlot={host.client ? <NotificationsCard client={host.client} /> : null}
      />
    );
  }

  // Settings is handled above; every live tab id has a body. This satisfies the
  // exhaustive return without a misleading fallback surface.
  return null;
}

/**
 * The PanelBody class for a tab: the terminal owns its full height + internal layout
 * (xterm well + accessory bar), so it gets no padding and clips; every other section
 * is a scrollable column.
 */
export function tabBodyClassName(tabId: TabId): string {
  return tabId === "terminal" ? "p-0 overflow-hidden" : "overflow-auto";
}
