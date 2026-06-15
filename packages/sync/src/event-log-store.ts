import type { DomainEvent } from "@swarm/core-engine";
import type { StoredEvent } from "./index";

/**
 * Storage port for the append-only event log. `@swarm/db` (built in parallel)
 * implements this over PGlite/Postgres; `@swarm/sync` never imports the db
 * package directly, it depends only on this seam. An in-memory implementation
 * ships here for tests and local-dev.
 *
 * Contract:
 *  - `append` assigns a strictly increasing, gap-free seq (1, 2, 3, …) and
 *    returns it. The host is the single writer (spec §4, no CRDT).
 *  - `readFrom(afterSeq)` returns every stored event with `seq > afterSeq`, in
 *    ascending seq order. This is the catch-up read a resuming client needs.
 *  - `head` returns the highest assigned seq (0 when empty).
 */
export interface EventLogStore {
  append(event: DomainEvent): Promise<number>;
  readFrom(afterSeq: number): Promise<readonly StoredEvent[]>;
  head(): Promise<number>;
}

/**
 * In-memory `EventLogStore` — a contiguous array where the seq is the 1-based
 * index. Used by the test suite and as the fallback before `@swarm/db` lands.
 */
export class InMemoryEventLogStore implements EventLogStore {
  private readonly events: StoredEvent[] = [];

  append(event: DomainEvent): Promise<number> {
    const seq = this.events.length + 1;
    this.events.push({ seq, event });
    return Promise.resolve(seq);
  }

  readFrom(afterSeq: number): Promise<readonly StoredEvent[]> {
    const from = afterSeq < 0 ? 0 : afterSeq;
    // seq === index + 1, so events with seq > afterSeq begin at index `afterSeq`.
    return Promise.resolve(this.events.slice(from));
  }

  head(): Promise<number> {
    return Promise.resolve(this.events.length);
  }
}
