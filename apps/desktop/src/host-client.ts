import type { AppRouter } from "@swarm/host/daemon";
import type { SyncConnection, SyncTransport, SyncTransportHandlers } from "@swarm/sync";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

/** How the renderer reaches the host: a loopback HTTP base + its bearer token. */
export interface HostConnection {
  readonly endpoint: string;
  readonly token: string;
}

declare global {
  interface Window {
    /** Exposed by the Electron preload (contextBridge); absent in a plain browser. */
    readonly grove?: {
      readonly getHostConnection: () => Promise<HostConnection | null>;
    };
    /** Test/dev injection seam (Playwright `addInitScript`); bypasses the bridge. */
    __GROVE_HOST__?: HostConnection;
  }
}

/** Candidate connection sources in precedence order — kept pure for unit testing. */
export interface ConnectionSources {
  /** From the Electron main process via the preload bridge (production path). */
  readonly bridge?: HostConnection | null;
  /** From a test/dev global injection. */
  readonly injected?: HostConnection | null;
  /** Vite build-time dev fallback. */
  readonly envUrl?: string;
  readonly envToken?: string;
}

/** First fully-specified source wins; `null` when nothing is configured. */
export function pickConnection(sources: ConnectionSources): HostConnection | null {
  const { bridge, injected, envUrl, envToken } = sources;
  if (bridge?.endpoint && bridge.token) {
    return { endpoint: bridge.endpoint, token: bridge.token };
  }
  if (injected?.endpoint && injected.token) {
    return { endpoint: injected.endpoint, token: injected.token };
  }
  if (envUrl && envToken) {
    return { endpoint: envUrl, token: envToken };
  }
  return null;
}

/** Resolve the live connection from the bridge, an injected global, then env. */
export async function resolveHostConnection(): Promise<HostConnection | null> {
  const bridge = (await window.grove?.getHostConnection()) ?? null;
  return pickConnection({
    bridge,
    injected: window.__GROVE_HOST__ ?? null,
    envUrl: import.meta.env.VITE_GROVE_HOST_URL,
    envToken: import.meta.env.VITE_GROVE_HOST_TOKEN,
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * A typed tRPC client over the host's HTTP endpoint. The router type comes from
 * the host package (type-only — erased at build, so no engine code ships in the
 * renderer) giving end-to-end type safety on every query/mutation. The bearer
 * token rides the `Authorization` header on every call (P11).
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

/** The WS sync URL derived from the HTTP endpoint; the host also authorizes the
 *  upgrade via the `token` query param, which is how a browser WebSocket (which
 *  cannot set an `Authorization` header) presents its credential. */
export function syncUrl(conn: HostConnection): string {
  const base = trimTrailingSlash(conn.endpoint).replace(/^http/, "ws");
  return `${base}/sync?token=${encodeURIComponent(conn.token)}`;
}

/** Query parameters for opening a terminal-IO WebSocket (P05). */
export interface TerminalParams {
  readonly workspaceId: string;
  /** Shell kind (`pwsh` | `powershell` | `cmd` | `bash` …); host default when omitted. */
  readonly shell?: string;
  readonly cols: number;
  readonly rows: number;
  /** When set, the host runs this command non-interactively and streams it (presets). */
  readonly cmd?: string;
}

/**
 * The ephemeral terminal-IO WS URL (separate topic from `/sync`). Like the sync
 * channel, the bearer token rides the `token` query param because a browser
 * WebSocket cannot set an `Authorization` header; the host gates the upgrade on it.
 */
export function terminalUrl(conn: HostConnection, params: TerminalParams): string {
  const base = trimTrailingSlash(conn.endpoint).replace(/^http/, "ws");
  const q = new URLSearchParams();
  q.set("token", conn.token);
  q.set("workspaceId", params.workspaceId);
  if (params.shell) {
    q.set("shell", params.shell);
  }
  q.set("cols", String(params.cols));
  q.set("rows", String(params.rows));
  if (params.cmd) {
    q.set("cmd", params.cmd);
  }
  return `${base}/terminal?${q.toString()}`;
}

/**
 * A {@link SyncTransport} over the browser/Electron-renderer global `WebSocket`.
 * The host ships a Node `ws`-backed transport; the {@link SyncClient} core is
 * transport-agnostic, so the renderer supplies this one and reuses the identical
 * catch-up/reconnect engine.
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
