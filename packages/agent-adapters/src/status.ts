import type { WorkspaceStatus } from "@swarm/db";

/**
 * Agent status inference (spec §2, P03 + P04 monitoring).
 *
 * The four live states an agent can be in are a strict subset of the shared
 * workspace-status enum, so a value produced here drops straight into the design
 * system's `STATUS_META` (color/label/shape) with no translation. `idle` is a
 * workspace-at-rest state owned by core-engine, never emitted by a running agent.
 */
export type AgentStatus = Extract<
  WorkspaceStatus,
  "running" | "needs_attention" | "done" | "error"
>;

/**
 * Marker the terminal adapter appends to the launched command line so the exit
 * code surfaces in the PTY stream (the supervisor spawns a shell, not the agent
 * process directly, so there is no process-exit event to listen on). The launch
 * line is run non-interactively (it is the shell's own argument, never typed at a
 * prompt), so it is not echoed back. The exit regex still requires digits — so
 * only the *executed* form (`:0`, `:1`, …), never an unexpanded literal
 * (`:$LASTEXITCODE` / `:%ERRORLEVEL%` / `:$?`), is ever treated as a real exit.
 */
export const EXIT_SENTINEL = "__SWARM_EXIT__";
const EXIT_RE = /__SWARM_EXIT__:(-?\d+)/;

/** Tuning + per-agent heuristics for turning raw output into a status. */
export interface StatusDetection {
  /** Output silence (ms) while `running` after which we flip to `needs_attention`. */
  readonly idleMs: number;
  /** Patterns meaning the agent is blocked waiting on user input (prompt/confirm). */
  readonly promptPatterns: readonly RegExp[];
  /** Patterns meaning the agent finished its turn (process may stay alive). */
  readonly donePatterns: readonly RegExp[];
  /** Patterns meaning a hard error (treated as terminal, like a non-zero exit). */
  readonly errorPatterns: readonly RegExp[];
}

/**
 * Generic, zero-config heuristics. Exit code is the authoritative done/error
 * signal; `errorPatterns` is intentionally empty so an agent merely *printing*
 * the word "error" mid-run is not mistaken for a failed run. Named presets layer
 * narrower patterns on top.
 */
export const DEFAULT_DETECTION: StatusDetection = {
  idleMs: 8_000,
  promptPatterns: [/\(y\/n\)/i, /\[y\/n\]/i, /press\s+enter/i, /continue\?/i, /\?\s*$/],
  donePatterns: [],
  errorPatterns: [],
};

/** Signals scanned out of a window of recent output. */
export interface OutputSignals {
  readonly sawExit: boolean;
  readonly exitCode: number | null;
  readonly sawError: boolean;
  readonly sawDone: boolean;
  readonly sawPrompt: boolean;
}

function anyMatch(text: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    // Reset lastIndex so a (possibly /g/) pattern is reusable across calls.
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/** Pure: scan a window of output for status-relevant signals. */
export function scanOutput(text: string, detection: StatusDetection): OutputSignals {
  const exit = EXIT_RE.exec(text);
  return {
    sawExit: exit !== null,
    exitCode: exit?.[1] !== undefined ? Number(exit[1]) : null,
    sawError: anyMatch(text, detection.errorPatterns),
    sawDone: anyMatch(text, detection.donePatterns),
    sawPrompt: anyMatch(text, detection.promptPatterns),
  };
}

/** Whether a status is terminal (no further transitions from output). */
export function isTerminal(status: AgentStatus): boolean {
  return status === "done" || status === "error";
}

export interface Transition {
  readonly status: AgentStatus;
  /** Once finished, output is ignored and the idle timer is cleared. */
  readonly finished: boolean;
}

/**
 * Pure status transition for one window of output. `finished` makes done/error
 * sticky (process exited / hard error); a done *pattern* is not sticky because a
 * turn-based agent can resume after reporting "done".
 */
export function nextFromOutput(
  current: AgentStatus,
  finished: boolean,
  signals: OutputSignals,
): Transition {
  if (finished) {
    return { status: current, finished: true };
  }
  if (signals.sawError || (signals.sawExit && (signals.exitCode ?? 0) !== 0)) {
    return { status: "error", finished: true };
  }
  if (signals.sawExit) {
    return { status: "done", finished: true };
  }
  if (signals.sawDone) {
    return { status: "done", finished: false };
  }
  if (signals.sawPrompt) {
    return { status: "needs_attention", finished: false };
  }
  return { status: "running", finished: false };
}

/**
 * Pure idle transition: only a `running` agent goes quiet into `needs_attention`.
 * A done/error agent (finished) or one already waiting stays put.
 */
export function nextFromIdle(current: AgentStatus, finished: boolean): AgentStatus {
  if (!finished && current === "running") {
    return "needs_attention";
  }
  return current;
}
