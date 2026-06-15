/**
 * @swarm/shared — branded ids, a Result type, cross-platform path/EOL helpers,
 * and constants every other package imports. Zero runtime dependencies.
 */

export const SHARED_VERSION = "0.1.0";

/** Product codename, surfaced in host handshakes and the UI. */
export const APP_CODENAME = "SWARM";

declare const brand: unique symbol;

/** Nominal/branded type so different id kinds are never interchangeable. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, "ProjectId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type SessionId = Brand<string, "SessionId">;
export type PresetId = Brand<string, "PresetId">;
export type HostId = Brand<string, "HostId">;
export type PtyId = Brand<string, "PtyId">;

/** Brand a raw string id at a trusted boundary (db reads, parsed input). */
export function asId<B extends string>(raw: string): Brand<string, B> {
  return raw as Brand<string, B>;
}

/** Discriminated result used instead of throwing across package seams. */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Convert any OS path to the POSIX form we store in the database (spec §5). */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Normalize file content to LF before storing or diffing (spec §5). */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** WebSocket sync topics a client may subscribe to (spec §4). */
export const SYNC_TOPICS = ["workspaces", "sessions", "diffs", "ports", "notifications"] as const;

export type SyncTopic = (typeof SYNC_TOPICS)[number];
