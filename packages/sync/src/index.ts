import type { DomainEvent } from "@swarm/core-engine";
import type { HostId } from "@swarm/shared";

/**
 * @swarm/sync — the WebSocket frame protocol and opaque resume token that drive
 * reconnect/catch-up over the append-only event log (spec §4, P10). Apply is
 * idempotent by `seq`, so replays are safe no-ops.
 */

export const SYNC_VERSION = "0.1.0";

export const SYNC_PROTOCOL_VERSION = 1;

export interface ResumeToken {
  readonly hostId: HostId;
  /** Highest event seq the client has durably applied. */
  readonly seq: number;
  readonly v: number;
}

/** Encode an opaque base64 resume token — the only state a client needs. */
export function encodeResumeToken(token: ResumeToken): string {
  return btoa(JSON.stringify(token));
}

export function decodeResumeToken(encoded: string): ResumeToken {
  return JSON.parse(atob(encoded)) as ResumeToken;
}

/**
 * An event paired with the monotonic seq the host assigned on append. The seq is
 * the durable cursor a client persists and resumes from; the log core and the
 * live tail always carry it so catch-up is exact (no gaps, no dupes).
 */
export interface StoredEvent {
  readonly seq: number;
  readonly event: DomainEvent;
}

export type SyncFrame =
  | { readonly t: "HELLO"; readonly resumeToken?: string; readonly topics: readonly string[] }
  | { readonly t: "BATCH"; readonly events: readonly DomainEvent[] }
  | { readonly t: "EVENT"; readonly seq: number; readonly event: DomainEvent }
  | { readonly t: "CAUGHT_UP"; readonly seq: number }
  | { readonly t: "ACK"; readonly seq: number }
  | { readonly t: "PING" }
  | { readonly t: "PONG" }
  | { readonly t: "RESET" }
  | { readonly t: "ERROR"; readonly code: string };

export type SyncFrameType = SyncFrame["t"];

const FRAME_TYPES: ReadonlySet<string> = new Set<SyncFrameType>([
  "HELLO",
  "BATCH",
  "EVENT",
  "CAUGHT_UP",
  "ACK",
  "PING",
  "PONG",
  "RESET",
  "ERROR",
]);

/** Serialize a frame for the wire. Frames are plain JSON over a text WS message. */
export function serializeFrame(frame: SyncFrame): string {
  return JSON.stringify(frame);
}

/** Parse and validate a wire message into a typed frame; throws on malformed input. */
export function parseFrame(raw: string): SyncFrame {
  const value = JSON.parse(raw) as unknown;
  if (typeof value === "object" && value !== null && "t" in value) {
    const tag = (value as Record<string, unknown>).t;
    if (typeof tag === "string" && FRAME_TYPES.has(tag)) {
      return value as SyncFrame;
    }
  }
  throw new Error("sync: malformed frame");
}

export * from "./event-log-store";
export * from "./event-log";
export * from "./client";
// Node-only surface (`node:http` + `ws`) lives behind `@swarm/sync/server`
// (see ./server-entry) so this entry stays browser-safe for PWA/neutral bundles.
