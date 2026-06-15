import type { SyncClientState } from "@swarm/sync";
import { Badge, Button } from "@swarm/ui/react";
import { Unlink } from "lucide-react";
import type { HostInfoView } from "./useHost.ts";

interface ConnectionCardProps {
  readonly info: HostInfoView;
  readonly syncState: SyncClientState;
  readonly onDisconnect: () => void;
}

/** Map the sync client state to a calm, labelled badge tone. */
function syncBadge(state: SyncClientState): {
  tone: "running" | "idle" | "attention";
  label: string;
} {
  if (state === "live") {
    return { tone: "running", label: "Live" };
  }
  if (state === "connecting" || state === "catching_up") {
    return { tone: "idle", label: "Syncing" };
  }
  return { tone: "attention", label: "Reconnecting" };
}

/**
 * The live connection panel shown in Settings once paired: which host this phone is
 * linked to, the `/sync` state, and a real Disconnect that clears the IndexedDB
 * bearer (ADR-0014) — fully unlinking the device.
 */
export function ConnectionCard({ info, syncState, onDisconnect }: ConnectionCardProps) {
  const badge = syncBadge(syncState);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">Paired host</span>
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
      </div>
      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-subtle">Endpoint</dt>
          <dd className="truncate font-mono text-fg-muted">{info.endpoint}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-subtle">Host</dt>
          <dd className="truncate font-mono text-fg-muted">{info.hostId}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-fg-subtle">Platform</dt>
          <dd className="font-mono text-fg-muted">
            {info.os} · v{info.version}
          </dd>
        </div>
      </dl>
      <Button variant="danger" icon={<Unlink className="size-4" />} onClick={onDisconnect}>
        Disconnect
      </Button>
    </div>
  );
}
