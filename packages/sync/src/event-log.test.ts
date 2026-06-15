import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "@swarm/core-engine";
import { asId } from "@swarm/shared";
import { EventLog } from "./event-log";
import type { ResumeHandlers } from "./event-log";
import { InMemoryEventLogStore } from "./event-log-store";

function wsEvent(i: number): DomainEvent {
  return { type: "workspace.created", workspaceId: asId<"WorkspaceId">(`w_${i}`), name: `ws-${i}` };
}

function collector(): {
  seqs: number[];
  handlers: ResumeHandlers;
  caughtUpAt(): number;
} {
  const seqs: number[] = [];
  let caughtUp = -1;
  return {
    seqs,
    caughtUpAt: () => caughtUp,
    handlers: {
      onBatch: (events) => {
        for (const e of events) {
          seqs.push(e.seq);
        }
      },
      onCaughtUp: (seq) => {
        caughtUp = seq;
      },
      onLive: (e) => {
        seqs.push(e.seq);
      },
    },
  };
}

describe("EventLog + InMemoryEventLogStore", () => {
  test("append assigns a monotonic, gap-free seq", async () => {
    const log = new EventLog(new InMemoryEventLogStore());
    const seqs = [
      await log.append(wsEvent(1)),
      await log.append(wsEvent(2)),
      await log.append(wsEvent(3)),
    ];
    expect(seqs).toEqual([1, 2, 3]);
    expect(await log.head()).toBe(3);
  });

  test("subscribeFrom(0) replays everything in order, then tails live appends", async () => {
    const log = new EventLog(new InMemoryEventLogStore());
    for (let i = 1; i <= 5; i++) {
      await log.append(wsEvent(i));
    }

    const c = collector();
    const unsubscribe = await log.subscribeFrom(0, c.handlers);
    expect(c.seqs).toEqual([1, 2, 3, 4, 5]);
    expect(c.caughtUpAt()).toBe(5);

    await log.append(wsEvent(6));
    expect(c.seqs).toEqual([1, 2, 3, 4, 5, 6]);
    unsubscribe();
  });

  test("disconnect -> append-while-away -> reconnect: exactly the missed events, no gaps/dupes", async () => {
    const log = new EventLog(new InMemoryEventLogStore());
    for (let i = 1; i <= 5; i++) {
      await log.append(wsEvent(i));
    }

    // Connect and catch up.
    const first = collector();
    const unsubscribe1 = await log.subscribeFrom(0, first.handlers);
    expect(first.seqs).toEqual([1, 2, 3, 4, 5]);

    // DISCONNECT.
    unsubscribe1();

    // Host keeps appending while the client is away.
    for (let i = 6; i <= 8; i++) {
      await log.append(wsEvent(i));
    }
    // The disconnected subscriber must not have received those.
    expect(first.seqs).toEqual([1, 2, 3, 4, 5]);

    // RECONNECT with the resume token (highest applied seq = 5).
    const resumed = collector();
    const unsubscribe2 = await log.subscribeFrom(5, resumed.handlers);
    expect(resumed.seqs).toEqual([6, 7, 8]); // exactly the missed events, in order
    expect(resumed.caughtUpAt()).toBe(8);

    // ...and it continues live.
    await log.append(wsEvent(9));
    expect(resumed.seqs).toEqual([6, 7, 8, 9]);

    // No duplicates anywhere across the resumed stream.
    expect(new Set(resumed.seqs).size).toBe(resumed.seqs.length);
    unsubscribe2();
  });

  test("an event appended during catch-up is delivered exactly once (race safety)", async () => {
    const log = new EventLog(new InMemoryEventLogStore());
    for (let i = 1; i <= 3; i++) {
      await log.append(wsEvent(i));
    }

    const c = collector();
    // Race the live append against the catch-up read.
    const subscribing = log.subscribeFrom(0, c.handlers);
    const appending = log.append(wsEvent(4));
    const [unsubscribe] = await Promise.all([subscribing, appending]);

    expect(c.seqs).toEqual([1, 2, 3, 4]);
    expect(new Set(c.seqs).size).toBe(4); // no dupe of seq 4
    unsubscribe();
  });
});
