import type { AppRouter } from "@swarm/api";
import { DEFAULT_DATABASE_URL } from "@swarm/db";
import { APP_CODENAME, type HostId, asId } from "@swarm/shared";
import { SYNC_PROTOCOL_VERSION } from "@swarm/sync";

/**
 * @swarm/host — the headless engine handle. The Hono server, PGlite, PTYs and
 * worktree IO land in Phase 2; this factory wires the typed handshake the CLI
 * and clients build against today, bound to loopback for privacy (P11).
 */

export const HOST_VERSION = "0.1.0";

const DEFAULT_BIND = "127.0.0.1:8787";

export interface HostOptions {
  /** Address the engine binds; loopback by default for privacy (P11). */
  readonly bind?: string;
  /** PGlite or Postgres connection string; defaults to embedded PGlite (ADR-0003). */
  readonly databaseUrl?: string;
}

export interface HostStatus {
  readonly hostId: HostId;
  readonly version: string;
  readonly online: boolean;
  readonly boundTo: string;
  readonly databaseUrl: string;
  readonly protocolVersion: number;
}

export interface Host {
  readonly hostId: HostId;
  status(): HostStatus;
}

/** Create a headless engine handle with resolved bind + database settings. */
export function createHost(options: HostOptions = {}): Host {
  const boundTo = options.bind ?? DEFAULT_BIND;
  const databaseUrl = options.databaseUrl ?? DEFAULT_DATABASE_URL;
  const hostId = asId<"HostId">(`${APP_CODENAME.toLowerCase()}-${boundTo}`);
  return {
    hostId,
    status(): HostStatus {
      return {
        hostId,
        version: HOST_VERSION,
        online: true,
        boundTo,
        databaseUrl,
        protocolVersion: SYNC_PROTOCOL_VERSION,
      };
    },
  };
}

/** Re-export the router contract so clients import host types from one place. */
export type { AppRouter };
