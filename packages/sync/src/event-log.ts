import type { DomainEvent } from "@swarm/core-engine";
import type { EventLogStore } from "./event-log-store";
import type { StoredEvent } from "./index";

/** Notified for every event appended after the listener was registered. */
export type LiveListener = (event: StoredEvent) => void;

/**
 * Sinks for a resuming subscriber. `onBatch` receives the events missed while
 * away (the catch-up replay), `onCaughtUp` fires once the replay is drained,
 * then `onLive` fires for each subsequent append. Every event with seq greater
 * than the resume point is delivered exactly once, in ascending seq order.
 */
export interface ResumeHandlers {
  readonly onBatch: (events: readonly StoredEvent[]) => void;
  readonly onCaughtUp: (seq: number) => void;
  readonly onLive: (event: StoredEvent) => void;
}

/**
 * The event-log core over an {@link EventLogStore}. The host is the single
 * writer: `append` serializes writes so seq assignment and live fan-out happen
 * atomically and in order. Subscribers resume from a seq and are guaranteed a
 * gap-free, dupe-free stream — the property that makes reconnect "replay from my
 * cursor" (spec §4).
 */
export class EventLog {
  private readonly listeners = new Set<LiveListener>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly store: EventLogStore) {}

  /** Append one event; resolves with its assigned seq once fan-out has run. */
  append(event: DomainEvent): Promise<number> {
    const result = this.writeChain.then(async () => {
      const seq = await this.store.append(event);
      const stored: StoredEvent = { seq, event };
      for (const listener of this.listeners) {
        listener(stored);
      }
      return seq;
    });
    // Keep the serialization chain alive even if this append (or a listener) throws.
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  head(): Promise<number> {
    return this.store.head();
  }

  readFrom(afterSeq: number): Promise<readonly StoredEvent[]> {
    return this.store.readFrom(afterSeq);
  }

  /** Register a raw live listener (no catch-up). Returns an unsubscribe fn. */
  subscribe(listener: LiveListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resume from `fromSeq`: replay missed events, then tail live ones. The
   * listener is attached *before* the catch-up read so an append racing the
   * read is buffered rather than lost; the buffer is then flushed with a
   * seq-based dedupe so an event present in both the read and the buffer is
   * delivered only once. Returns an unsubscribe fn.
   */
  async subscribeFrom(fromSeq: number, handlers: ResumeHandlers): Promise<() => void> {
    let caughtUp = false;
    let lastSent = fromSeq;
    const buffer: StoredEvent[] = [];

    const deliverLive = (stored: StoredEvent): void => {
      if (stored.seq <= lastSent) {
        return; // already delivered via catch-up — idempotent by seq.
      }
      handlers.onLive(stored);
      lastSent = stored.seq;
    };

    const unsubscribe = this.subscribe((stored) => {
      if (caughtUp) {
        deliverLive(stored);
      } else {
        buffer.push(stored);
      }
    });

    try {
      const missed = await this.readFrom(fromSeq);
      if (missed.length > 0) {
        handlers.onBatch(missed);
        const last = missed[missed.length - 1];
        if (last !== undefined) {
          lastSent = last.seq;
        }
      }
      handlers.onCaughtUp(lastSent);
      // No await between here and the flush, so no live event can interleave.
      caughtUp = true;
      for (const stored of buffer) {
        deliverLive(stored);
      }
      buffer.length = 0;
    } catch (error) {
      unsubscribe();
      throw error;
    }

    return unsubscribe;
  }
}
