import type { HostId } from "@swarm/shared";
import {
  type ResumeToken,
  SYNC_PROTOCOL_VERSION,
  type StoredEvent,
  type SyncFrame,
  encodeResumeToken,
  parseFrame,
  serializeFrame,
} from "./index";

/** One live connection produced by a {@link SyncTransport}. */
export interface SyncConnection {
  send(data: string): void;
  close(): void;
}

/** Callbacks the client hands a transport so it can pump socket lifecycle in. */
export interface SyncTransportHandlers {
  readonly onOpen: () => void;
  readonly onMessage: (data: string) => void;
  readonly onClose: () => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Transport seam: anything that can open a duplex text channel (a real
 * WebSocket, an in-process pipe in tests, a browser `WebSocket`, …). The client
 * is transport-agnostic and only ever sees this interface.
 */
export interface SyncTransport {
  open(handlers: SyncTransportHandlers): SyncConnection;
}

export type SyncClientState =
  | "idle"
  | "connecting"
  | "catching_up"
  | "live"
  | "reconnecting"
  | "closed";

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;
  /** Fraction of the delay that is randomized, in [0, 1]. */
  readonly jitter: number;
}

const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 250,
  maxMs: 10_000,
  factor: 2,
  jitter: 0.5,
};

export interface SyncClientOptions {
  readonly transport: SyncTransport;
  readonly hostId: HostId;
  readonly topics?: readonly string[];
  /** Called once per event, in ascending seq order, with no gaps or dupes. */
  readonly onEvent: (event: StoredEvent) => void;
  readonly onStateChange?: (state: SyncClientState) => void;
  /** Cache was discarded by the host (token hostId mismatch). */
  readonly onReset?: () => void;
  /** Resume from a persisted high-water mark (PGlite/localStorage cursor). */
  readonly startSeq?: number;
  readonly backoff?: Partial<BackoffOptions>;
  /** Send an ACK after this many applied events (and on catch-up). Default 32. */
  readonly ackEvery?: number;
  /** Reconnect automatically on socket drop. Default true. */
  readonly autoReconnect?: boolean;
}

/**
 * Transport-agnostic sync client. On (re)connect it sends a HELLO carrying its
 * resume token, folds the BATCH catch-up then the live EVENT tail through
 * `onEvent`, and on socket drop reconnects with jittered exponential backoff —
 * always resuming from its last applied seq, so it catches up on exactly the
 * events it missed (spec §4). Apply is idempotent by seq.
 */
export class SyncClient {
  private readonly backoff: BackoffOptions;
  private readonly topics: readonly string[];
  private readonly ackEvery: number;
  private readonly autoReconnect: boolean;

  private state: SyncClientState = "idle";
  private conn: SyncConnection | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private appliedSinceAck = 0;
  private closed = false;
  /** Highest seq durably applied — the resume cursor. */
  private lastSeq: number;

  constructor(private readonly opts: SyncClientOptions) {
    this.backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.topics = opts.topics ?? [];
    this.ackEvery = opts.ackEvery ?? 32;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.lastSeq = opts.startSeq ?? 0;
  }

  /** Open the first connection. Idempotent while already connected. */
  start(): void {
    if (this.closed || this.conn !== undefined || this.reconnectTimer !== undefined) {
      return;
    }
    this.connect();
  }

  /** The current resume cursor (highest applied seq). */
  getLastSeq(): number {
    return this.lastSeq;
  }

  getState(): SyncClientState {
    return this.state;
  }

  resumeToken(): ResumeToken {
    return { hostId: this.opts.hostId, seq: this.lastSeq, v: SYNC_PROTOCOL_VERSION };
  }

  /** Drop the socket but keep the cursor; reconnect happens if autoReconnect. */
  disconnect(): void {
    this.clearReconnect();
    const conn = this.conn;
    this.conn = undefined;
    conn?.close();
  }

  /** Permanently stop the client; no further reconnects. */
  close(): void {
    this.closed = true;
    this.clearReconnect();
    const conn = this.conn;
    this.conn = undefined;
    conn?.close();
    this.setState("closed");
  }

  private connect(): void {
    if (this.closed) {
      return;
    }
    this.setState(this.attempt > 0 ? "reconnecting" : "connecting");
    this.conn = this.opts.transport.open({
      onOpen: () => this.handleOpen(),
      onMessage: (data) => this.handleMessage(data),
      onClose: () => this.handleClose(),
      onError: () => {
        // A failed/erroring socket always resolves to onClose; reconnect there.
      },
    });
  }

  private handleOpen(): void {
    this.setState("catching_up");
    this.send({
      t: "HELLO",
      resumeToken: encodeResumeToken(this.resumeToken()),
      topics: this.topics,
    });
  }

  private handleMessage(data: string): void {
    let frame: SyncFrame;
    try {
      frame = parseFrame(data);
    } catch {
      return; // ignore garbage; heartbeat/close will recover a broken peer.
    }

    switch (frame.t) {
      case "BATCH": {
        // Catch-up replay is contiguous from the resume seq, so each event's seq
        // is the next one after our cursor.
        for (const evt of frame.events) {
          this.apply(this.lastSeq + 1, evt);
        }
        break;
      }
      case "EVENT": {
        this.apply(frame.seq, frame.event);
        break;
      }
      case "CAUGHT_UP": {
        this.attempt = 0;
        this.maybeAck(true);
        this.setState("live");
        break;
      }
      case "PING": {
        this.send({ t: "PONG" });
        break;
      }
      case "RESET": {
        this.lastSeq = 0;
        this.appliedSinceAck = 0;
        this.opts.onReset?.();
        // Re-handshake from a clean cursor on the same socket.
        this.handleOpen();
        break;
      }
      default:
        break; // PONG / ACK / ERROR carry no client action here.
    }
  }

  private apply(seq: number, payload: StoredEvent["event"]): void {
    if (seq <= this.lastSeq) {
      return; // duplicate — idempotent by seq.
    }
    if (seq > this.lastSeq + 1) {
      // A gap means we missed something; resync from our cursor.
      this.disconnect();
      if (!this.closed && this.autoReconnect) {
        this.scheduleReconnect();
      }
      return;
    }
    this.lastSeq = seq;
    this.opts.onEvent({ seq, event: payload });
    this.appliedSinceAck += 1;
    this.maybeAck(false);
  }

  private maybeAck(force: boolean): void {
    if (this.lastSeq === 0) {
      return;
    }
    if (force || this.appliedSinceAck >= this.ackEvery) {
      this.send({ t: "ACK", seq: this.lastSeq });
      this.appliedSinceAck = 0;
    }
  }

  private handleClose(): void {
    this.conn = undefined;
    if (this.closed || !this.autoReconnect) {
      if (!this.closed) {
        this.setState("idle");
      }
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== undefined) {
      return;
    }
    const delay = this.computeBackoff(this.attempt);
    this.attempt += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private computeBackoff(attempt: number): number {
    const ceiling = Math.min(
      this.backoff.maxMs,
      this.backoff.baseMs * this.backoff.factor ** attempt,
    );
    const fixed = ceiling * (1 - this.backoff.jitter);
    return fixed + Math.random() * this.backoff.jitter * ceiling;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private send(frame: SyncFrame): void {
    this.conn?.send(serializeFrame(frame));
  }

  private setState(next: SyncClientState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.opts.onStateChange?.(next);
  }
}
