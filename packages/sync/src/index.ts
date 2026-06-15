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
