import type { Workspace, WorkspaceStatus } from "@swarm/db";
import { SyncClient, type SyncClientState } from "@swarm/sync";
import { useCallback, useEffect, useState } from "react";
import {
  type HostConnection,
  type HostTrpcClient,
  browserWebSocketTransport,
  createHostClient,
  resolveHostConnection,
  syncUrl,
} from "../host-client.ts";

export type HostPhase = "connecting" | "connected" | "no-host" | "error";

export interface HostInfoView {
  readonly endpoint: string;
  readonly hostId: string;
  readonly os: string;
  readonly version: string;
}

export interface HostState {
  readonly phase: HostPhase;
  readonly workspaces: readonly Workspace[];
  /** Live status overlay folded from the sync event stream, keyed by workspace id. */
  readonly liveStatus: ReadonlyMap<string, WorkspaceStatus>;
  readonly syncState: SyncClientState;
  readonly info: HostInfoView | null;
  /** The live tRPC client (diffs/terminal/workspaces); null until connected. */
  readonly client: HostTrpcClient | null;
  /** The resolved `{endpoint, token}` — what the terminal-IO WS needs; null until connected. */
  readonly conn: HostConnection | null;
  readonly error: string | null;
  readonly retry: () => void;
}

/** The status the UI should show: a live event overrides the materialized row. */
export function effectiveStatus(
  ws: Workspace,
  liveStatus: ReadonlyMap<string, WorkspaceStatus>,
): WorkspaceStatus {
  return liveStatus.get(ws.id) ?? ws.status;
}

/**
 * Owns the host connection lifecycle for the shell: resolve `{endpoint, token}`,
 * make a real tRPC `host.status` + `workspaces.list` round-trip, then subscribe to
 * the live event stream over the sync WebSocket and fold status changes into an
 * overlay. Every transition is surfaced as a real phase the shell renders
 * (connecting / connected / no-host / error), never a crash.
 */
export function useHost(): HostState {
  const [phase, setPhase] = useState<HostPhase>("connecting");
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [liveStatus, setLiveStatus] = useState<ReadonlyMap<string, WorkspaceStatus>>(new Map());
  const [syncState, setSyncState] = useState<SyncClientState>("idle");
  const [info, setInfo] = useState<HostInfoView | null>(null);
  const [client, setClient] = useState<HostTrpcClient | null>(null);
  const [conn, setConn] = useState<HostConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the (re)connect is intentionally keyed on the retry nonce; the body uses only stable setters + module functions.
  useEffect(() => {
    let cancelled = false;
    let sync: SyncClient | undefined;

    setPhase("connecting");
    setError(null);
    setSyncState("idle");
    setLiveStatus(new Map());
    setClient(null);
    setConn(null);

    void (async () => {
      const resolved = await resolveHostConnection();
      if (cancelled) {
        return;
      }
      if (!resolved) {
        setPhase("no-host");
        return;
      }
      try {
        const client = createHostClient(resolved);
        const status = await client.host.status.query();
        if (cancelled) {
          return;
        }
        const list = await client.workspaces.list.query(undefined);
        if (cancelled) {
          return;
        }
        setInfo({
          endpoint: resolved.endpoint,
          hostId: status.hostId,
          os: status.os,
          version: status.version,
        });
        setWorkspaces(list);
        // The tRPC client is a CALLABLE proxy, so it must be stored via the lazy
        // updater form — `setClient(client)` would make React invoke it as a state
        // updater instead of storing it.
        setClient(() => client);
        setConn(resolved);
        setPhase("connected");

        sync = new SyncClient({
          transport: browserWebSocketTransport(syncUrl(resolved)),
          hostId: status.hostId,
          onEvent: ({ event }) => {
            if (event.type === "workspace.status_changed") {
              setLiveStatus((prev) => {
                const next = new Map(prev);
                next.set(event.workspaceId, event.status);
                return next;
              });
            }
          },
          onStateChange: (next) => {
            if (!cancelled) {
              setSyncState(next);
            }
          },
        });
        sync.start();
      } catch (err) {
        if (cancelled) {
          return;
        }
        setPhase("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      sync?.close();
    };
  }, [nonce]);

  return { phase, workspaces, liveStatus, syncState, info, client, conn, error, retry };
}
