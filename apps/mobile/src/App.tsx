import { BottomNav, Panel, PanelBody, PanelHeader, PanelTitle, Spinner } from "@swarm/ui/react";
import { useMemo, useState } from "react";
import { ConnectedTabBody, tabBodyFills } from "./host/ConnectedView.tsx";
import { PairingScreen } from "./host/PairingScreen.tsx";
import { useHost } from "./host/useHost.ts";
import { AppBar } from "./shell/AppBar.tsx";
import { DEFAULT_TAB, NAV_TABS, TAB_BY_ID, type TabId } from "./shell/tabs.ts";

/** AppBar + a centered status, used while loading IndexedDB / handshaking. */
function StatusFrame({ message }: { readonly message: string }) {
  return (
    <div className="grid h-[100dvh] grid-rows-[auto_minmax(0,1fr)] bg-base text-fg">
      <AppBar />
      <main className="grid min-h-0 place-items-center p-6">
        <div className="flex flex-col items-center gap-3 text-fg-muted">
          <Spinner size="lg" />
          <p className="text-sm">{message}</p>
        </div>
      </main>
    </div>
  );
}

/**
 * The Grove phone shell (Phase-4 W2): the PWA, now connected to the REAL host
 * (ADR-0014). It resolves a stored pairing from IndexedDB and either shows the
 * pairing screen or goes LIVE — real `host.status` + `workspaces.list` + `/sync`,
 * with a disconnect that unlinks the device. Terminal/diff/agent control journeys
 * layer onto this live connection in W3/W4.
 */
export function App() {
  const host = useHost();
  const [active, setActive] = useState<TabId>(DEFAULT_TAB);

  const navItems = useMemo(
    () => NAV_TABS.map(({ id, label, icon: Icon }) => ({ id, label, icon: <Icon /> })),
    [],
  );

  if (host.phase === "loading") {
    return <StatusFrame message="Looking for a paired host…" />;
  }
  if (host.phase === "connecting") {
    return <StatusFrame message="Connecting to your host…" />;
  }

  if (host.phase !== "connected") {
    // unpaired (no stored pairing) or error (stored pairing unreachable).
    const isError = host.phase === "error";
    return (
      <div className="grid h-[100dvh] grid-rows-[auto_minmax(0,1fr)] bg-base text-fg">
        <AppBar />
        <main className="min-h-0 overflow-hidden">
          <PairingScreen
            pair={host.pair}
            notice={
              isError
                ? "Couldn't reach the host you paired earlier — it may be offline or on another network."
                : null
            }
            onRetry={isError ? host.reconnect : undefined}
            onForget={isError ? () => void host.disconnect() : undefined}
          />
        </main>
      </div>
    );
  }

  const tab = TAB_BY_ID[active];
  const TabIcon = tab.icon;

  return (
    <div className="grid h-[100dvh] grid-rows-[auto_minmax(0,1fr)_auto] bg-base text-fg">
      <AppBar />

      <main className="min-h-0 overflow-hidden px-3 pt-3 pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <Panel className="h-full">
          <PanelHeader>
            <PanelTitle icon={<TabIcon />}>{tab.heading}</PanelTitle>
          </PanelHeader>
          <PanelBody className={tabBodyFills(tab.id) ? "overflow-auto" : "grid place-items-center"}>
            <ConnectedTabBody host={host} tab={tab} />
          </PanelBody>
        </Panel>
      </main>

      <BottomNav
        aria-label="Sections"
        items={navItems}
        value={active}
        onChange={(id) => setActive(id as TabId)}
      />
    </div>
  );
}
