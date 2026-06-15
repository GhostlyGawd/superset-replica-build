import { createServer } from "node:http";
import type { HostId } from "@swarm/shared";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { EventLog } from "./event-log";
import {
  type StoredEvent,
  type SyncFrame,
  decodeResumeToken,
  parseFrame,
  serializeFrame,
} from "./index";

export interface SyncServerOptions {
  readonly log: EventLog;
  /** The host identity clients must present in their resume token. */
  readonly hostId: HostId;
  /** TCP port; 0 (default) binds an OS-assigned ephemeral port. */
  readonly port?: number;
  /** Bind address; defaults to 127.0.0.1 (private-by-default, P11). */
  readonly host?: string;
  /** WS path; defaults to /sync. */
  readonly path?: string;
  /** Heartbeat PING interval in ms; 0 disables. Default 15000. */
  readonly heartbeatMs?: number;
  /** Max events per BATCH frame during catch-up. Default 512. */
  readonly batchSize?: number;
}

export interface SyncServer {
  /** Resolved port (meaningful after the server is listening). */
  readonly port: number;
  readonly url: string;
  /** Live connection count. */
  clientCount(): number;
  /** Last seq each connected client has acked — the resume high-water marks. */
  clientCursors(): readonly number[];
  close(): Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PATH = "/sync";
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_BATCH_SIZE = 512;

function rawToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return (data as Buffer).toString("utf8");
}

function* chunk<T>(items: readonly T[], size: number): Generator<readonly T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Node-side WebSocket sync hub. Each connection: validates the HELLO resume
 * token's hostId (mismatch ⇒ RESET), replays missed events as BATCH frames,
 * sends CAUGHT_UP, then streams live EVENT frames as the host appends. Terminal
 * IO is intentionally NOT carried here — it rides an ephemeral topic (spec §4).
 */
export function createSyncServer(opts: SyncServerOptions): Promise<SyncServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const path = opts.path ?? DEFAULT_PATH;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  return new Promise((resolve, reject) => {
    // Own the HTTP server explicitly so close() can forcibly drop lingering
    // sockets; relying on ws to create+close its own server can hang on a
    // half-closed connection from an earlier reconnect.
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer, path });
    const cursors = new Map<WebSocket, number>();

    const onListenError = (error: Error): void => {
      reject(error);
    };
    httpServer.once("error", onListenError);

    wss.on("connection", (socket: WebSocket) => {
      cursors.set(socket, 0);
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const send = (frame: SyncFrame): void => {
        if (socket.readyState === socket.OPEN) {
          socket.send(serializeFrame(frame));
        }
      };

      const onLive = (stored: StoredEvent): void => {
        send({ t: "EVENT", seq: stored.seq, event: stored.event });
      };

      const cleanup = (): void => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = undefined;
        }
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        cursors.delete(socket);
      };

      const startStream = async (fromSeq: number): Promise<void> => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = undefined;
        }
        unsubscribe = await opts.log.subscribeFrom(fromSeq, {
          onBatch: (events) => {
            for (const part of chunk(events, batchSize)) {
              send({ t: "BATCH", events: part.map((e) => e.event) });
            }
          },
          onCaughtUp: (seq) => send({ t: "CAUGHT_UP", seq }),
          onLive,
        });
      };

      socket.on("message", (raw: RawData) => {
        let frame: SyncFrame;
        try {
          frame = parseFrame(rawToString(raw));
        } catch {
          send({ t: "ERROR", code: "BAD_FRAME" });
          return;
        }

        switch (frame.t) {
          case "HELLO": {
            let fromSeq = 0;
            if (frame.resumeToken !== undefined) {
              try {
                const token = decodeResumeToken(frame.resumeToken);
                if (token.hostId !== opts.hostId) {
                  send({ t: "RESET" });
                  return; // client drops cache and re-HELLOs from seq 0.
                }
                fromSeq = token.seq;
              } catch {
                send({ t: "RESET" });
                return;
              }
            }
            cursors.set(socket, fromSeq);
            void startStream(fromSeq);
            break;
          }
          case "ACK": {
            cursors.set(socket, frame.seq);
            break;
          }
          case "PING": {
            send({ t: "PONG" });
            break;
          }
          default:
            break;
        }
      });

      socket.on("pong", () => {
        // Heartbeat reply; the connection is alive.
      });
      socket.on("error", () => {
        // The subsequent close event performs cleanup.
      });
      socket.on("close", cleanup);

      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => send({ t: "PING" }), heartbeatMs);
      }
    });

    httpServer.listen(opts.port ?? 0, host, () => {
      httpServer.off("error", onListenError);
      const address = httpServer.address();
      const port =
        typeof address === "object" && address !== null ? address.port : (opts.port ?? 0);

      resolve({
        port,
        url: `ws://${host}:${port}${path}`,
        clientCount: () => wss.clients.size,
        clientCursors: () => Array.from(cursors.values()),
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const client of wss.clients) {
              client.terminate();
            }
            const finish = (): void => {
              // Drop any lingering raw sockets so the listener can fully release.
              httpServer.closeAllConnections();
              // Under bun, wss.close() already stops the shared http server, so
              // only close it ourselves when it is still listening (node).
              if (httpServer.listening) {
                httpServer.close(() => resolveClose());
              } else {
                resolveClose();
              }
            };
            wss.close(() => finish());
          }),
      });
    });
  });
}
