/**
 * @swarm/config — the `.swarm/config.json` schema shape and the env vars
 * injected into setup/teardown/run commands (spec §3, P07). All lifecycle
 * commands are authored in TS/Node, never .sh, per ADR-0004.
 */

export const CONFIG_VERSION = "0.1.0";

/** Path, relative to a project root, of the workspace config file. */
export const CONFIG_FILE_PATH = ".swarm/config.json";

/** Env vars injected into every lifecycle command (spec §3, §5). */
export const ENV_VARS = {
  rootPath: "SWARM_ROOT_PATH",
  workspaceName: "SWARM_WORKSPACE_NAME",
  workspacePath: "SWARM_WORKSPACE_PATH",
} as const;
export type EnvVarName = (typeof ENV_VARS)[keyof typeof ENV_VARS];

export interface CommandSpec {
  readonly command: string;
  readonly args?: readonly string[];
}

export interface SwarmConfig {
  readonly setup?: CommandSpec;
  readonly teardown?: CommandSpec;
  readonly run?: CommandSpec;
  readonly before?: CommandSpec;
  readonly after?: CommandSpec;
}

export const DEFAULT_CONFIG: SwarmConfig = {};
