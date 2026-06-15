import { EmptyState } from "@swarm/ui/react";
import type { ComponentType } from "react";
import { SettingsPanel } from "../shell/SettingsPanel.tsx";
import type { TabDef, TabId } from "../shell/tabs.ts";
import { ConnectionCard } from "./ConnectionCard.tsx";
import { WorkspaceList } from "./WorkspaceList.tsx";
import type { HostState } from "./useHost.ts";

/**
 * Honest connected-state copy for the sections whose full journeys land in later
 * waves (W3 read journeys, W4 terminal). They are NOT empty promises: the phone IS
 * paired and live; these simply state what arrives next, with no fabricated data.
 */
const PENDING_COPY: Record<Exclude<TabId, "workspaces" | "settings">, string> = {
  agents:
    "You're paired and live. Driving agents from your phone arrives in an upcoming Grove update.",
  terminal: "You're paired and live. A touch-driven terminal arrives in an upcoming Grove update.",
  diff: "You're paired and live. On-the-go diff review arrives in an upcoming Grove update.",
};

interface TabBodyProps {
  readonly host: HostState;
  readonly tab: TabDef;
}

/** Render the live body for the active section once the phone is connected. */
export function ConnectedTabBody({ host, tab }: TabBodyProps) {
  const Icon: ComponentType<{ readonly className?: string }> = tab.icon;

  if (tab.id === "workspaces") {
    return <WorkspaceList workspaces={host.workspaces} liveStatus={host.liveStatus} />;
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

  return <EmptyState icon={<Icon />} title={tab.heading} description={PENDING_COPY[tab.id]} />;
}

/** Whether a tab's body fills the panel (lists/forms) vs. centers an empty state. */
export function tabBodyFills(tabId: TabId): boolean {
  return tabId === "workspaces" || tabId === "settings";
}
