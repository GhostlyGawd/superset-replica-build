import type { WorkspaceStatus } from "@swarm/db";

/**
 * @swarm/ui — shared design tokens and component prop contracts for the desktop
 * renderer and mobile PWA (spec §2). Status hues are keyed by semantics, never
 * random colors (RUBRIC §6.3). React implementations land with the clients.
 */

export const UI_VERSION = "0.1.0";

/** Spacing scale in px — the dense developer-tool rhythm. */
export const SPACING = [0, 2, 4, 8, 12, 16, 24, 32] as const;

/** Status color tokens keyed by meaning so state is legible at a glance. */
export const STATUS_TOKENS: Readonly<Record<WorkspaceStatus, string>> = {
  idle: "slate",
  running: "blue",
  needs_attention: "amber",
  error: "red",
  done: "green",
};

export interface StatusBadgeProps {
  readonly status: WorkspaceStatus;
  readonly label?: string;
}

export interface WorkspaceListItemProps {
  readonly id: string;
  readonly name: string;
  readonly status: WorkspaceStatus;
  readonly selected: boolean;
}
