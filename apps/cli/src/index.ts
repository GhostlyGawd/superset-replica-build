import { createHost } from "@swarm/host";

/**
 * @swarm/cli — the `swarm` command-line entrypoint (spec §2, P13). Verb parsing
 * is real from Phase 0; daemon/remote behavior attaches to the engine handle in
 * Phase 2/5.
 */

export const CLI_VERSION = "0.1.0";

export const CLI_COMMANDS = ["start", "stop", "status", "projects", "workspaces", "auth"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export interface ParsedInvocation {
  readonly command: CliCommand;
  readonly args: readonly string[];
}

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

/** Parse `swarm <command> [args]` into a typed invocation. */
export function parseArgv(argv: readonly string[]): ParsedInvocation {
  const first = argv[0] ?? "status";
  if (!isCliCommand(first)) {
    throw new Error(`Unknown swarm command: ${first}`);
  }
  return { command: first, args: argv.slice(1) };
}

/** Render the line the `swarm status` verb prints. */
export function statusLine(): string {
  const status = createHost().status();
  return `swarm ${status.version} bound ${status.boundTo} online=${status.online}`;
}
