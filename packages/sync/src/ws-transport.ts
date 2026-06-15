import { type RawData, WebSocket } from "ws";
import type { SyncConnection, SyncTransport, SyncTransportHandlers } from "./client";

function rawToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return (data as Buffer).toString("utf8");
}

/**
 * A {@link SyncTransport} backed by the `ws` package (Node host + desktop). Each
 * `open` dials a fresh socket, so the client's reconnect loop gets a clean
 * connection every attempt. Browsers would supply a transport over the global
 * `WebSocket` instead; the client core is identical.
 */
export function webSocketTransport(url: string): SyncTransport {
  return {
    open(handlers: SyncTransportHandlers): SyncConnection {
      const socket = new WebSocket(url);
      socket.on("open", () => handlers.onOpen());
      socket.on("message", (raw: RawData) => handlers.onMessage(rawToString(raw)));
      socket.on("error", (error) => handlers.onError(error));
      socket.on("close", () => handlers.onClose());

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
