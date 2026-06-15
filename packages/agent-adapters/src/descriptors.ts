/**
 * Built-in adapter descriptors (spec §2, P03). Command/arg templates and the
 * zero-config generic adapter; status heuristics and the launch path build on
 * these (see `presets.ts`, `terminal-adapter.ts`).
 */

export const BUILTIN_ADAPTER_IDS = [
  "claude-code",
  "codex-cli",
  "cursor-agent",
  "gemini-cli",
  "generic",
] as const;
export type AdapterId = (typeof BUILTIN_ADAPTER_IDS)[number];

export interface AdapterDescriptor {
  readonly id: AdapterId;
  readonly label: string;
  readonly command: string;
  readonly argsTemplate: readonly string[];
  readonly supportsModelOverride: boolean;
  /** The generic adapter runs whatever terminal command the user provides. */
  readonly generic: boolean;
}

export const BUILTIN_ADAPTERS: readonly AdapterDescriptor[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    argsTemplate: [],
    supportsModelOverride: true,
    generic: false,
  },
  {
    id: "codex-cli",
    label: "OpenAI Codex CLI",
    command: "codex",
    argsTemplate: [],
    supportsModelOverride: true,
    generic: false,
  },
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    command: "cursor-agent",
    argsTemplate: [],
    supportsModelOverride: false,
    generic: false,
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    command: "gemini",
    argsTemplate: [],
    supportsModelOverride: true,
    generic: false,
  },
  {
    id: "generic",
    label: "Generic CLI",
    command: "",
    argsTemplate: [],
    supportsModelOverride: false,
    generic: true,
  },
];
