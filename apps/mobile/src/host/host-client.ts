import type { AppRouter } from "@swarm/host/daemon";
import type { SyncConnection, SyncTransport, SyncTransportHandlers } from "@swarm/sync";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { HostConnection } from "./connection-store.ts";

/**
 * The browser host-client for the PWA — the mobile mirror of the desktop's
 * `apps/desktop/src/host-client.ts`, minus the Electron preload bridge. The PWA
 * obtains `{endpoint, token}` by REDEEMING a pairing code (no manifest on a phone),
 * stores it in IndexedDB, and then talks to the same `/trpc` + `/sync` surface with
 * the bearer on every call (P11). The `AppRouter` type is import-type only, so the
 * host engine is fully erased at build — no node-pty/PGlite ships in the bundle.
 */

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * The endpoint to use by default: the page origin. The host serves the PWA
 * same-origin (ADR-0014), so the API lives at the very origin the app loaded from —
 * which is exactly what works over the LAN (a 127.0.0.1 value from the host would
 * not be reachable from the phone).
 */
export function resolveDefaultEndpoint(): string {
  return trimTrailingSlash(window.location.origin);
}

/**
 * A typed tRPC client over the host's HTTP endpoint with the bearer on every call.
 * The router type is erased at build (type-only), giving end-to-end type safety
 * without shipping engine code to the phone.
 */
export function createHostClient(conn: HostConnection) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${trimTrailingSlash(conn.endpoint)}/trpc`,
        headers: () => ({ Authorization: `Bearer ${conn.token}` }),
      }),
    ],
  });
}

export type HostTrpcClient = ReturnType<typeof createHostClient>;

/**
 * A bearer-LESS tRPC client used ONLY to call the public `pair.redeem`. Keeping it
 * separate guarantees the redeem is never batched with a bearer-gated procedure,
 * so it always hits the host's whitelisted `/trpc/pair.redeem` path.
 */
export function createPairClient(endpoint: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${trimTrailingSlash(endpoint)}/trpc` })],
  });
}

export type PairTrpcClient = ReturnType<typeof createPairClient>;

/**
 * The WS sync URL derived from the HTTP endpoint. A browser WebSocket cannot set an
 * `Authorization` header, so the bearer rides the `token` query param, which is how
 * the host authorizes the upgrade.
 */
export function syncUrl(conn: HostConnection): string {
  const base = trimTrailingSlash(conn.endpoint).replace(/^http/, "ws");
  return `${base}/sync?token=${encodeURIComponent(conn.token)}`;
}

/**
 * A {@link SyncTransport} over the browser global `WebSocket`. The transport-agnostic
 * {@link SyncClient} core supplies the catch-up/reconnect engine; this just wires the
 * socket events to its handlers — identical to the desktop renderer's transport.
 */
export function browserWebSocketTransport(url: string): SyncTransport {
  return {
    open(handlers: SyncTransportHandlers): SyncConnection {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => handlers.onOpen());
      socket.addEventListener("message", (event: MessageEvent) => {
        handlers.onMessage(String(event.data));
      });
      socket.addEventListener("error", (event) => handlers.onError(event));
      socket.addEventListener("close", () => handlers.onClose());
      return {
        send: (data: string) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
          }
        },
        close: () => socket.close(),
      };
    },
  };
}
