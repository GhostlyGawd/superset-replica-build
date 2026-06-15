import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "@swarm/core-engine";
import { asId } from "@swarm/shared";
import type { HostId } from "@swarm/shared";
import { EventLog, InMemoryEventLogStore, SyncClient } from "./index";
import { createSyncServer } from "./server";
import { webSocketTransport } from "./ws-transport";

function evt(i: number): DomainEvent {
  return { type: "workspace.created", workspaceId: asId<"WorkspaceId">(`w_${i}`), name: `ws-${i}` };
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("waitFor timed out"));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("ws sync transport (loopback)", () => {
  test("binds an ephemeral 127.0.0.1 port and resolves a url", async () => {
    const log = new EventLog(new InMemoryEventLogStore());
    const server = await createSyncServer({
      log,
      hostId: asId<"HostId">("host_bind"),
      port: 0,
      host: "127.0.0.1",
      heartbeatMs: 0,
    });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`ws://127.0.0.1:${server.port}/sync`);
    } finally {
      await server.close();
    }
  });

  test("catch-up -> disconnect -> reconnect+resume -> live, over a real socket", async () => {
    const host: HostId = asId<"HostId">("host_ws");
    const log = new EventLog(new InMemoryEventLogStore());
    for (let i = 1; i <= 4; i++) {
      await log.append(evt(i));
    }

    const server = await createSyncServer({
      log,
      hostId: host,
      port: 0,
      host: "127.0.0.1",
      heartbeatMs: 0,
    });

    try {
      const applied: number[] = [];
      const client = new SyncClient({
        transport: webSocketTransport(server.url),
        hostId: host,
        autoReconnect: false,
        ackEvery: 1,
        onEvent: (e) => applied.push(e.seq),
      });

      // Connect + initial catch-up to seq 4.
      client.start();
      await waitFor(() => client.getState() === "live" && client.getLastSeq() === 4, 5000);
      expect(applied).toEqual([1, 2, 3, 4]);

      // A live append arrives while connected.
      await log.append(evt(5));
      await waitFor(() => client.getLastSeq() === 5, 5000);
      expect(applied).toEqual([1, 2, 3, 4, 5]);

      // DISCONNECT (phone sleep / network switch).
      client.disconnect();
      await waitFor(() => client.getState() === "idle", 5000);

      // Host keeps appending while the client is away.
      for (let i = 6; i <= 8; i++) {
        await log.append(evt(i));
      }
      expect(client.getLastSeq()).toBe(5);

      // RECONNECT with the resume token (seq 5).
      client.start();
      await waitFor(() => client.getState() === "live" && client.getLastSeq() === 8, 5000);
      expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // exactly the missed events
      expect(new Set(applied).size).toBe(applied.length); // no duplicates

      // Still live after the resume.
      await log.append(evt(9));
      await waitFor(() => client.getLastSeq() === 9, 5000);
      expect(applied).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // The host recorded the client's ACK high-water mark.
      expect(server.clientCursors().some((c) => c >= 8)).toBe(true);

      client.close();
    } finally {
      await server.close();
    }
  });
});
