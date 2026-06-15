import type { AppRouter } from "@swarm/api";
import { type HostId, asId } from "@swarm/shared";
import { encodeResumeToken } from "@swarm/sync";
import { UI_VERSION } from "@swarm/ui";

/**
 * @swarm/mobile — the PWA client context (ADR-0006). A thin client over the
 * sync channel: installable, offline-first, Web Push. The React + Vite app and
 * service worker land in Phase 4; the sync bootstrap is real from Phase 0.
 */

export const MOBILE_VERSION = "0.1.0";

export interface MobileApp {
  readonly uiVersion: string;
  /** Persisted resume token bootstraps the offline-first sync client (spec §4). */
  readonly resumeToken: string;
}

/** Build the mobile application context, seeding a fresh resume token. */
export function createMobileApp(hostId: HostId = asId<"HostId">("swarm-local")): MobileApp {
  return {
    uiVersion: UI_VERSION,
    resumeToken: encodeResumeToken({ hostId, seq: 0, v: 1 }),
  };
}

/** Re-export the router contract for the typed tRPC client. */
export type { AppRouter };
