import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { type AdapterDescriptor, type AdapterId, BUILTIN_ADAPTERS } from "./descriptors.ts";
import { DEFAULT_DETECTION, type StatusDetection } from "./status.ts";

const execFileAsync = promisify(execFile);

/**
 * Named adapter presets (spec §2, P03). Each preset is the built-in descriptor
 * plus tuned status detection and default env, layered on the universal terminal
 * adapter. They never fake a run: if the CLI is not installed, `detectAdapter`
 * reports `not_found` with an actionable message and the caller surfaces it.
 */
export interface AgentPreset {
  readonly descriptor: AdapterDescriptor;
  readonly detection: StatusDetection;
  readonly env: Readonly<Record<string, string>>;
}

// Per-agent heuristics. Exit code stays authoritative (handled by the terminal
// adapter); these only narrow when an agent is *waiting* or has *finished a turn*
// while its process keeps running. Tunable later in Settings → Agents.
const DETECTION_BY_ID: Readonly<Record<AdapterId, StatusDetection>> = {
  "claude-code": {
    idleMs: 12_000,
    promptPatterns: [/do you want to proceed\?/i, /\(y\/n\)/i, /❯/, /press\s+enter/i],
    donePatterns: [],
    errorPatterns: [/^\s*error:/im, /execution error/i],
  },
  "codex-cli": {
    idleMs: 12_000,
    promptPatterns: [/allow command\?/i, /\(y\/n\)/i, /approve\?/i],
    donePatterns: [],
    errorPatterns: [/^\s*error:/im],
  },
  "cursor-agent": {
    idleMs: 12_000,
    promptPatterns: [/\(y\/n\)/i, /accept\?/i, /apply changes\?/i],
    donePatterns: [],
    errorPatterns: [/^\s*error:/im],
  },
  "gemini-cli": {
    idleMs: 12_000,
    promptPatterns: [/\(y\/n\)/i, /confirm\?/i, /press\s+enter/i],
    donePatterns: [],
    errorPatterns: [/^\s*error:/im],
  },
  generic: DEFAULT_DETECTION,
};

const ENV_BY_ID: Readonly<Record<AdapterId, Readonly<Record<string, string>>>> = {
  "claude-code": {},
  "codex-cli": {},
  "cursor-agent": {},
  "gemini-cli": {},
  generic: {},
};

export const AGENT_PRESETS: readonly AgentPreset[] = BUILTIN_ADAPTERS.map((descriptor) => ({
  descriptor,
  detection: DETECTION_BY_ID[descriptor.id],
  env: ENV_BY_ID[descriptor.id],
}));

const PRESETS_BY_ID = new Map<AdapterId, AgentPreset>(
  AGENT_PRESETS.map((preset) => [preset.descriptor.id, preset]),
);

export function getPreset(id: AdapterId): AgentPreset {
  const preset = PRESETS_BY_ID.get(id);
  if (preset === undefined) {
    throw new Error(`Unknown adapter id: ${id}`);
  }
  return preset;
}

export type AvailabilityStatus = "available" | "not_found" | "unknown";

export interface AdapterAvailability {
  readonly adapterId: AdapterId;
  readonly command: string;
  readonly status: AvailabilityStatus;
  readonly resolvedPath?: string;
  /** One-line, user-facing explanation suitable for Settings → Agents. */
  readonly detail: string;
}

/** Drive (`C:\`), POSIX root (`/`), or UNC (`\\server`) — accepts any extension. */
function looksAbsolute(line: string): boolean {
  return /^([a-zA-Z]:[\\/]|[\\/]|\\\\)/.test(line);
}

/**
 * Resolve a command to a concrete executable path, or `undefined` if not found.
 * Never throws — graceful degradation is the contract (the caller maps `undefined`
 * to `not_found`).
 *
 * 1. If `command` is already an absolute path that exists on disk, return it
 *    verbatim (a user may configure a full path to a CLI). This also makes
 *    detection independent of `where.exe`/`which` and PATH, which can be unreliable
 *    under the Bun test runtime on the GH `windows-latest` runner.
 * 2. Otherwise look it up: `where.exe` on Windows (a bare `where` is not reliably
 *    resolved by `execFile`, which ignores `PATHEXT`), `which` on POSIX. Both print
 *    one match per line and exit non-zero when nothing matches. We trim CR, take the
 *    first absolute-looking line (so a stray `INFO:`/warning line is never mistaken
 *    for a hit), and prefer one that exists on disk. A non-zero exit with no usable
 *    path yields `undefined` (⇒ not found). Any `.exe`/`.cmd`/`.bat` shim qualifies.
 */
async function resolveOnPath(command: string): Promise<string | undefined> {
  const trimmed = command.trim();
  if (isAbsolute(trimmed) && existsSync(trimmed)) {
    return trimmed;
  }
  const finder = process.platform === "win32" ? "where.exe" : "which";
  let stdout = "";
  try {
    stdout = (await execFileAsync(finder, [trimmed])).stdout ?? "";
  } catch (error) {
    // Nothing matched (non-zero exit) — or a spawn hiccup: parse whatever was
    // captured before giving up, so a real hit that still printed its path is honored.
    stdout = (error as { stdout?: string }).stdout ?? "";
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => looksAbsolute(line) && existsSync(line)) ?? lines.find(looksAbsolute);
}

/**
 * Probe whether a preset's CLI is on PATH, using `where.exe` (Windows) / `which`
 * (POSIX). Never throws and never fakes success: a missing CLI returns
 * `not_found` with guidance, so the universal adapter can still be configured by
 * hand. The generic adapter has no fixed command and reports `unknown`.
 */
export async function detectAdapter(preset: AgentPreset): Promise<AdapterAvailability> {
  const { id } = preset.descriptor;
  const command = preset.descriptor.command;
  if (preset.descriptor.generic || command.length === 0) {
    return {
      adapterId: id,
      command,
      status: "unknown",
      detail: "Generic adapter: provide any terminal command to launch it.",
    };
  }
  try {
    const resolvedPath = await resolveOnPath(command);
    if (resolvedPath === undefined) {
      return {
        adapterId: id,
        command,
        status: "not_found",
        detail: `${preset.descriptor.label} CLI "${command}" was not found on PATH.`,
      };
    }
    return {
      adapterId: id,
      command,
      status: "available",
      resolvedPath,
      detail: `${preset.descriptor.label} resolved to ${resolvedPath}.`,
    };
  } catch {
    return {
      adapterId: id,
      command,
      status: "not_found",
      detail: `${preset.descriptor.label} CLI "${command}" is not installed or not on PATH. Install it or set a custom command in Settings → Agents.`,
    };
  }
}
