import { type Host, createHost } from "@swarm/host";
import { UI_VERSION } from "@swarm/ui";

/**
 * @swarm/desktop — the Electron shell context (ADR-0005). Electron main embeds
 * the engine in-process for local use; the renderer (React + xterm) lands in
 * Phase 3. The embedded host wiring is real so the renderer compiles against it.
 */

export const DESKTOP_VERSION = "0.1.0";

export interface DesktopApp {
  readonly host: Host;
  readonly uiVersion: string;
}

/** Build the desktop application context with an embedded engine handle. */
export function createDesktopApp(): DesktopApp {
  return {
    host: createHost(),
    uiVersion: UI_VERSION,
  };
}
