/**
 * Default command presets bound to Ctrl+1–9 (P05). The host's `presets` router is
 * not yet implemented, so the renderer ships these built-ins; each runs as a real
 * command in a fresh terminal tab over the `/terminal` topic (the host spawns the
 * shell non-interactively and streams its output). Slot 1 is a deterministic ping
 * the e2e asserts on.
 */
export interface TerminalPreset {
  /** Ctrl+<slot>, 1–9. */
  readonly slot: number;
  readonly label: string;
  readonly command: string;
}

export const DEFAULT_PRESETS: readonly TerminalPreset[] = [
  { slot: 1, label: "ping", command: "echo grove-terminal-online" },
  { slot: 2, label: "status", command: "git status -sb" },
  { slot: 3, label: "log", command: "git log --oneline -10" },
  { slot: 4, label: "branch", command: "git branch --show-current" },
  { slot: 5, label: "diff", command: "git diff --stat" },
];

export function presetForSlot(slot: number): TerminalPreset | undefined {
  return DEFAULT_PRESETS.find((p) => p.slot === slot);
}
