import type { ShellKind } from "@swarm/pty-supervisor";

/**
 * @swarm/terminal — the xterm.js wrapper contract shared by desktop and mobile
 * (spec §2, P05). The renderer-side addons and ConPTY-aware rendering wire up
 * in Phase 3; the option shapes are fixed from Phase 0.
 */

export const TERMINAL_VERSION = "0.1.0";

/** xterm.js addons always loaded for parity with the original terminal. */
export const TERMINAL_ADDONS = ["fit", "search", "web-links", "serialize", "unicode11"] as const;
export type TerminalAddon = (typeof TERMINAL_ADDONS)[number];

export interface TerminalOptions {
  readonly shell: ShellKind;
  readonly cols: number;
  readonly rows: number;
  readonly fontFamily: string;
  readonly fontSize: number;
}

export const DEFAULT_TERMINAL_OPTIONS: Omit<TerminalOptions, "shell"> = {
  cols: 80,
  rows: 24,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 13,
};
