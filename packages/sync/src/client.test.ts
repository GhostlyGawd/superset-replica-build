import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "@swarm/core-engine";
import { asId } from "@swarm/shared";
import type { HostId } from "@swarm/shared";
import {
  SyncClient,
  type SyncConnection,
  type SyncFrame,
  type SyncTransport,
  type SyncTransportHandlers,
  decodeResumeToken,
  parseFrame,
  serializeFrame,
} from "./index";

const HOST: HostId = asId<"HostId">("host_test");

function evt(i: number): DomainEvent {
  return { type: "workspace.created", workspaceId: asId<"WorkspaceId">(`w_${i}`), name: `ws-${i}` };
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
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
      setTimeout(tick, 2);
    };
    tick();
  });
}

/** A transport whose socket lifecycle the test drives by hand. */
class FakeTransport implements SyncTransport {
  opens = 0;
  readonly sent: SyncFrame[] = [];
  private handlers: SyncTransportHandlers | undefined;

  open(handlers: SyncTransportHandlers): SyncConnection {
    this.opens += 1;
    this.handlers = handlers;
    return {
      send: (data) => {
        this.sent.push(parseFrame(data));
      },
      close: () => {
        this.handlers?.onClose();
      },
    };
  }

  fireOpen(): void {
    this.handlers?.onOpen();
  }

  deliver(frame: SyncFrame): void {
    this.handlers?.onMessage(serializeFrame(frame));
  }

  drop(): void {
    this.handlers?.onClose();
  }

  lastHello(): Extract<SyncFrame, { t: "HELLO" }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const frame = this.sent[i];
      if (frame !== undefined && frame.t === "HELLO") {
        return frame;
      }
    }
    return undefined;
  }
}

describe("SyncClient", () => {
  test("catches up via BATCH, sends HELLO from seq 0, then applies live EVENTs idempotently", () => {
    const transport = new FakeTransport();
    const applied: number[] = [];
    const client = new SyncClient({
      transport,
      hostId: HOST,
      autoReconnect: false,
      onEvent: (e) => applied.push(e.seq),
    });

    client.start();
    expect(transport.opens).toBe(1);
    transport.fireOpen();

    const hello = must(transport.lastHello(), "HELLO");
    expect(decodeResumeToken(must(hello.resumeToken, "resumeToken")).seq).toBe(0);

    transport.deliver({ t: "BATCH", events: [evt(1), evt(2), evt(3)] });
    transport.deliver({ t: "CAUGHT_UP", seq: 3 });
    expect(applied).toEqual([1, 2, 3]);
    expect(client.getState()).toBe("live");
    expect(client.getLastSeq()).toBe(3);

    transport.deliver({ t: "EVENT", seq: 4, event: evt(4) });
    expect(applied).toEqual([1, 2, 3, 4]);

    // A duplicate EVENT (e.g. a replayed frame) is a no-op.
    transport.deliver({ t: "EVENT", seq: 4, event: evt(4) });
    expect(applied).toEqual([1, 2, 3, 4]);

    client.close();
  });

  test("on socket drop it reconnects and re-HELLOs from its last applied seq", async () => {
    const transport = new FakeTransport();
    const applied: number[] = [];
    const client = new SyncClient({
      transport,
      hostId: HOST,
      autoReconnect: true,
      backoff: { baseMs: 5, maxMs: 20, factor: 2, jitter: 0 },
      onEvent: (e) => applied.push(e.seq),
    });

    client.start();
    transport.fireOpen();
    transport.deliver({ t: "BATCH", events: [evt(1), evt(2)] });
    transport.deliver({ t: "CAUGHT_UP", seq: 2 });
    expect(client.getLastSeq()).toBe(2);

    transport.drop();
    expect(client.getState()).toBe("reconnecting");

    await waitFor(() => transport.opens === 2, 1000);
    transport.fireOpen();

    // The resume token on the new connection carries the high-water mark.
    const hello = must(transport.lastHello(), "second HELLO");
    expect(decodeResumeToken(must(hello.resumeToken, "resumeToken")).seq).toBe(2);

    transport.deliver({ t: "BATCH", events: [evt(3), evt(4)] });
    transport.deliver({ t: "CAUGHT_UP", seq: 4 });
    expect(applied).toEqual([1, 2, 3, 4]); // exact catch-up, no gaps, no dupes

    client.close();
  });

  test("a seq gap triggers a resync instead of applying out of order", async () => {
    const transport = new FakeTransport();
    const applied: number[] = [];
    const client = new SyncClient({
      transport,
      hostId: HOST,
      autoReconnect: true,
      backoff: { baseMs: 5, maxMs: 20, factor: 2, jitter: 0 },
      onEvent: (e) => applied.push(e.seq),
    });

    client.start();
    transport.fireOpen();
    transport.deliver({ t: "BATCH", events: [evt(1)] });
    transport.deliver({ t: "CAUGHT_UP", seq: 1 });
    expect(client.getLastSeq()).toBe(1);

    // A future event (seq 3 while at 1) is a gap: it must not be applied.
    transport.deliver({ t: "EVENT", seq: 3, event: evt(3) });
    expect(applied).toEqual([1]);

    // The client tears down and reconnects to re-fetch from its cursor.
    await waitFor(() => transport.opens === 2, 1000);
    client.close();
  });

  test("RESET drops the cursor and re-handshakes from seq 0", () => {
    const transport = new FakeTransport();
    const applied: number[] = [];
    const client = new SyncClient({
      transport,
      hostId: HOST,
      autoReconnect: false,
      startSeq: 9,
      onEvent: (e) => applied.push(e.seq),
    });

    client.start();
    transport.fireOpen();
    expect(
      decodeResumeToken(must(must(transport.lastHello(), "HELLO").resumeToken, "rt")).seq,
    ).toBe(9);

    transport.deliver({ t: "RESET" });
    // Re-handshake should now resume from 0.
    expect(
      decodeResumeToken(must(must(transport.lastHello(), "HELLO2").resumeToken, "rt")).seq,
    ).toBe(0);
    expect(client.getLastSeq()).toBe(0);

    client.close();
  });
});
