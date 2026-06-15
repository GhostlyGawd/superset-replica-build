import type { Workspace, WorkspaceStatus } from "@swarm/db";
import { SyncClient, type SyncClientState } from "@swarm/sync";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useState } from "react";
import {
  type HostConnection,
  clearConnection,
  loadConnection,
  saveConnection,
} from "./connection-store.ts";
import {
  type HostTrpcClient,
  browserWebSocketTransport,
  createHostClient,
  createPairClient,
  resolveDefaultEndpoint,
  syncUrl,
} from "./host-client.ts";

/**
 * - `loading`: reading IndexedDB for a stored pairing.
 * - `unpaired`: no stored pairing — show the pairing screen.
 * - `connecting`: handshaking with the host (`host.status` + `workspaces.list`).
 * - `connected`: live — real data + a `/sync` subscription.
 * - `error`: a stored pairing failed to connect (host down / token rotated).
 */
export type HostPhase = "loading" | "unpaired" | "connecting" | "connected" | "error";

export interface HostInfoView {
  readonly endpoint: string;
  readonly hostId: string;
  readonly os: string;
  readonly version: string;
}

export type PairOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface HostState {
  readonly phase: HostPhase;
  readonly workspaces: readonly Workspace[];
  /** Live status overlay folded from the `/sync` event stream, keyed by workspace id. */
  readonly liveStatus: ReadonlyMap<string, WorkspaceStatus>;
  readonly syncState: SyncClientState;
  readonly info: HostInfoView | null;
  readonly client: HostTrpcClient | null;
  readonly conn: HostConnection | null;
  readonly error: string | null;
  /** Redeem a pairing code → persist the bearer in IndexedDB → go live. */
  readonly pair: (code: string) => Promise<PairOutcome>;
  /** Forget the host (clear IndexedDB) and return to the pairing screen. */
  readonly disconnect: () => Promise<void>;
  /** Re-run the connect handshake (e.g. after an `error`). */
  readonly reconnect: () => void;
  /** Re-query `workspaces.list` without a reconnect. */
  readonly refresh: () => void;
}

/** The status the UI should show: a live event overrides the materialized row. */
export function effectiveStatus(
  ws: Workspace,
  liveStatus: ReadonlyMap<string, WorkspaceStatus>,
): WorkspaceStatus {
  return liveStatus.get(ws.id) ?? ws.status;
}

/** Map a redeem/connect failure to a calm, actionable line for the pairing screen. */
function humanizePairError(err: unknown): string {
  if (err instanceof TRPCClientError) {
    const code = (err.data as { code?: string } | null | undefined)?.code;
    if (code === "TOO_MANY_REQUESTS") {
      return "Too many attempts. Wait a moment, then generate a fresh code with `grove pair`.";
    }
    return "That code was not accepted. Generate a fresh one with `grove pair` and try again.";
  }
  return "Could not reach the host. Make sure it is running and on the same network.";
}

/**
 * Owns the PWA's host-connection lifecycle: resolve a stored pairing from IndexedDB,
 * make a real `host.status` + `workspaces.list` round-trip, then subscribe to the
 * live event stream over `/sync` and fold status changes into an overlay. Pairing
 * redeems a code (public `pair.redeem`) for the bearer and persists it. Mirrors the
 * desktop `useHost`, with IndexedDB replacing the Electron manifest bridge.
 */
export function useHost(): HostState {
  const [phase, setPhase] = useState<HostPhase>("loading");
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [liveStatus, setLiveStatus] = useState<ReadonlyMap<string, WorkspaceStatus>>(new Map());
  const [syncState, setSyncState] = useState<SyncClientState>("idle");
  const [info, setInfo] = useState<HostInfoView | null>(null);
  const [client, setClient] = useState<HostTrpcClient | null>(null);
  const [conn, setConn] = useState<HostConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);

  const refresh = useCallback(() => {
    if (!client) {
      return;
    }
    void (async () => {
      try {
        const list = await client.workspaces.list.query(undefined);
        setWorkspaces(list);
      } catch {
        // A transient refetch failure leaves the existing list in place.
      }
    })();
  }, [client]);

  const pair = useCallback(async (code: string): Promise<PairOutcome> => {
    const endpoint = resolveDefaultEndpoint();
    try {
      const pairClient = createPairClient(endpoint);
      const grant = await pairClient.pair.redeem.mutate({ code });
      // Same-origin (ADR-0014): use the page origin, not the host's loopback value,
      // so the stored endpoint is reachable from the phone over the LAN.
      await saveConnection({ endpoint, token: grant.token, resumeToken: grant.resumeToken });
      setNonce((n) => n + 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: humanizePairError(err) };
    }
  }, []);

  const disconnect = useCallback(async () => {
    await clearConnection();
    setNonce((n) => n + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the connect is intentionally keyed on the nonce; the body uses only stable setters + module functions.
  useEffect(() => {
    let cancelled = false;
    let sync: SyncClient | undefined;

    setError(null);
    setSyncState("idle");
    setLiveStatus(new Map());
    setClient(null);

    void (async () => {
      setPhase("loading");
      const stored = await loadConnection();
      if (cancelled) {
        return;
      }
      if (!stored) {
        setConn(null);
        setInfo(null);
        setWorkspaces([]);
        setPhase("unpaired");
        return;
      }
      setPhase("connecting");
      try {
        const hostClient = createHostClient(stored);
        const status = await hostClient.host.status.query();
        if (cancelled) {
          return;
        }
        const list = await hostClient.workspaces.list.query(undefined);
        if (cancelled) {
          return;
        }
        setInfo({
          endpoint: stored.endpoint,
          hostId: status.hostId,
          os: status.os,
          version: status.version,
        });
        setWorkspaces(list);
        // A tRPC client is a CALLABLE proxy, so it must be stored via the lazy
        // updater form — `setClient(client)` would have React invoke it.
        setClient(() => hostClient);
        setConn(stored);
        setPhase("connected");

        sync = new SyncClient({
          transport: browserWebSocketTransport(syncUrl(stored)),
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
        setConn(stored);
        setPhase("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      sync?.close();
    };
  }, [nonce]);

  return {
    phase,
    workspaces,
    liveStatus,
    syncState,
    info,
    client,
    conn,
    error,
    pair,
    disconnect,
    reconnect,
    refresh,
  };
}
