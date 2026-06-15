import { type Result, err, ok } from "@swarm/shared";

/**
 * @swarm/config — the `.swarm/config.json` schema, its machine-local overlay,
 * and the validator/merger for both (recon §6, architecture §2, P07).
 * `setup`/`teardown`/`run` are ordered arrays of cross-platform commands; a
 * gitignored overlay prepends/appends commands per field. Every command is
 * authored in TS and run on the user-selected shell — never `.sh` — so Windows
 * (PowerShell/cmd) and POSIX (sh/bash/zsh) hosts behave identically (ADR-0004).
 */

export const CONFIG_VERSION = "0.1.0";

/** Path, relative to a project root, of the committed workspace config. */
export const CONFIG_FILE_PATH = ".swarm/config.json";

/** Path of the gitignored, machine-local overlay (recon §6). */
export const CONFIG_LOCAL_FILE_PATH = ".swarm/config.local.json";

/** Env vars injected into every lifecycle command (architecture §2, §5). */
export const ENV_VARS = {
  rootPath: "SWARM_ROOT_PATH",
  workspaceName: "SWARM_WORKSPACE_NAME",
  workspacePath: "SWARM_WORKSPACE_PATH",
} as const;
export type EnvVarName = (typeof ENV_VARS)[keyof typeof ENV_VARS];

/** Shells a command may target across OSes (spec §5). */
export const SHELLS = ["pwsh", "powershell", "cmd", "bash", "sh", "zsh", "wsl"] as const;
export type Shell = (typeof SHELLS)[number];

/** A command line pinned to a specific shell. */
export interface ShellCommand {
  /** Literal command line handed to the shell. */
  readonly run: string;
  /** Shell to execute on; omit to use the OS's default shell. */
  readonly shell?: Shell;
}

/**
 * One lifecycle command. A bare string is cross-platform and runs on each OS's
 * default shell. The object form supplies a distinct command line (optionally a
 * specific shell) per OS family, so a Windows PowerShell/cmd line and a POSIX sh
 * line need not be identical — closing the original's `.sh`-only gap (recon §11).
 */
export type Command = string | PlatformCommand;

export interface PlatformCommand {
  /** Command run on Windows (pwsh/powershell/cmd). */
  readonly windows?: string | ShellCommand;
  /** Command run on macOS/Linux (sh/bash/zsh). */
  readonly posix?: string | ShellCommand;
}

/** The three lifecycle phases of a workspace (recon §6, P07). */
export const CONFIG_FIELDS = ["setup", "teardown", "run"] as const;
export type ConfigField = (typeof CONFIG_FIELDS)[number];

/** The committed `.swarm/config.json`: each phase is an ordered command list. */
export interface SwarmConfig {
  /** Runs in a terminal when a workspace is created (deps, env files, services). */
  readonly setup: readonly Command[];
  /** Runs when a workspace is deleted (stop services, clean up). */
  readonly teardown: readonly Command[];
  /** Runs on the Run command (Ctrl+Shift+G) in a dedicated terminal pane. */
  readonly run: readonly Command[];
}

/** Prepend/append lists applied to one field by the local overlay (recon §6). */
export interface CommandOverlay {
  readonly before?: readonly Command[];
  readonly after?: readonly Command[];
}

/** The gitignored `.swarm/config.local.json`: a per-field before/after overlay. */
export interface SwarmConfigOverlay {
  readonly setup?: CommandOverlay;
  readonly teardown?: CommandOverlay;
  readonly run?: CommandOverlay;
}

/** An empty but valid config: every phase present, no commands. */
export const DEFAULT_CONFIG: SwarmConfig = { setup: [], teardown: [], run: [] };

/** A validation failure pinpointing where parsing broke. */
export interface ConfigError {
  /** Dotted location of the offending value, e.g. `setup[1].windows.shell`. */
  readonly path: string;
  readonly message: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShell(value: unknown): value is Shell {
  return typeof value === "string" && (SHELLS as readonly string[]).includes(value);
}

function parseShellCommand(
  value: Record<string, unknown>,
  path: string,
): Result<ShellCommand, ConfigError> {
  for (const key of Object.keys(value)) {
    if (key !== "run" && key !== "shell") {
      return err({
        path: `${path}.${key}`,
        message: "a shell command allows only `run` and `shell`",
      });
    }
  }
  if (typeof value.run !== "string" || value.run.trim() === "") {
    return err({ path: `${path}.run`, message: "`run` must be a non-empty string" });
  }
  if (value.shell !== undefined) {
    if (!isShell(value.shell)) {
      return err({
        path: `${path}.shell`,
        message: `unknown shell; expected one of ${SHELLS.join(", ")}`,
      });
    }
    return ok({ run: value.run, shell: value.shell });
  }
  return ok({ run: value.run });
}

function parseOsBranch(value: unknown, path: string): Result<string | ShellCommand, ConfigError> {
  if (typeof value === "string") {
    if (value.trim() === "") {
      return err({ path, message: "command string must not be empty" });
    }
    return ok(value);
  }
  if (!isObject(value)) {
    return err({ path, message: "expected a string or a { run, shell? } object" });
  }
  return parseShellCommand(value, path);
}

function parseCommand(value: unknown, path: string): Result<Command, ConfigError> {
  if (typeof value === "string") {
    if (value.trim() === "") {
      return err({ path, message: "command string must not be empty" });
    }
    return ok(value);
  }
  if (!isObject(value)) {
    return err({
      path,
      message: "command must be a string or a per-OS { windows?, posix? } object",
    });
  }
  for (const key of Object.keys(value)) {
    if (key !== "windows" && key !== "posix") {
      return err({
        path: `${path}.${key}`,
        message: "a per-OS command allows only `windows` and `posix`",
      });
    }
  }
  if (value.windows === undefined && value.posix === undefined) {
    return err({ path, message: "a per-OS command must set `windows` and/or `posix`" });
  }
  const out: { windows?: string | ShellCommand; posix?: string | ShellCommand } = {};
  if (value.windows !== undefined) {
    const branch = parseOsBranch(value.windows, `${path}.windows`);
    if (!branch.ok) {
      return branch;
    }
    out.windows = branch.value;
  }
  if (value.posix !== undefined) {
    const branch = parseOsBranch(value.posix, `${path}.posix`);
    if (!branch.ok) {
      return branch;
    }
    out.posix = branch.value;
  }
  return ok(out);
}

function parseCommandArray(value: unknown, path: string): Result<Command[], ConfigError> {
  if (value === undefined) {
    return ok([]);
  }
  if (!Array.isArray(value)) {
    return err({ path, message: "expected an array of commands" });
  }
  const out: Command[] = [];
  for (let i = 0; i < value.length; i++) {
    const parsed = parseCommand(value[i], `${path}[${i}]`);
    if (!parsed.ok) {
      return parsed;
    }
    out.push(parsed.value);
  }
  return ok(out);
}

function rejectUnknownFields(value: Record<string, unknown>): ConfigError | null {
  for (const key of Object.keys(value)) {
    if (!(CONFIG_FIELDS as readonly string[]).includes(key)) {
      return { path: key, message: `unknown field; allowed: ${CONFIG_FIELDS.join(", ")}` };
    }
  }
  return null;
}

/** Validate a parsed `.swarm/config.json` into a `SwarmConfig` (missing fields default to `[]`). */
export function parseConfig(raw: unknown): Result<SwarmConfig, ConfigError> {
  if (!isObject(raw)) {
    return err({ path: "", message: "config root must be an object" });
  }
  const unknown = rejectUnknownFields(raw);
  if (unknown) {
    return err(unknown);
  }
  const setup = parseCommandArray(raw.setup, "setup");
  if (!setup.ok) {
    return setup;
  }
  const teardown = parseCommandArray(raw.teardown, "teardown");
  if (!teardown.ok) {
    return teardown;
  }
  const run = parseCommandArray(raw.run, "run");
  if (!run.ok) {
    return run;
  }
  return ok({ setup: setup.value, teardown: teardown.value, run: run.value });
}

function parseCommandOverlay(value: unknown, path: string): Result<CommandOverlay, ConfigError> {
  if (!isObject(value)) {
    return err({ path, message: "overlay field must be a { before?, after? } object" });
  }
  for (const key of Object.keys(value)) {
    if (key !== "before" && key !== "after") {
      return err({
        path: `${path}.${key}`,
        message: "an overlay field allows only `before` and `after`",
      });
    }
  }
  const out: { before?: Command[]; after?: Command[] } = {};
  if (value.before !== undefined) {
    const before = parseCommandArray(value.before, `${path}.before`);
    if (!before.ok) {
      return before;
    }
    out.before = before.value;
  }
  if (value.after !== undefined) {
    const after = parseCommandArray(value.after, `${path}.after`);
    if (!after.ok) {
      return after;
    }
    out.after = after.value;
  }
  return ok(out);
}

/** Validate a parsed `.swarm/config.local.json` into a `SwarmConfigOverlay`. */
export function parseOverlay(raw: unknown): Result<SwarmConfigOverlay, ConfigError> {
  if (!isObject(raw)) {
    return err({ path: "", message: "overlay root must be an object" });
  }
  const unknown = rejectUnknownFields(raw);
  if (unknown) {
    return err(unknown);
  }
  const out: SwarmConfigOverlay = {};
  const mut: { setup?: CommandOverlay; teardown?: CommandOverlay; run?: CommandOverlay } = out;
  for (const field of CONFIG_FIELDS) {
    const branch = raw[field];
    if (branch === undefined) {
      continue;
    }
    const parsed = parseCommandOverlay(branch, field);
    if (!parsed.ok) {
      return parsed;
    }
    mut[field] = parsed.value;
  }
  return ok(out);
}

/**
 * Apply a local overlay to a committed config: for each field the result is
 * `[...before, ...committed, ...after]`, so machine-specific steps wrap the
 * shared ones without rewriting them (recon §6).
 */
export function mergeConfig(base: SwarmConfig, overlay: SwarmConfigOverlay): SwarmConfig {
  const mergeField = (field: ConfigField): Command[] => [
    ...(overlay[field]?.before ?? []),
    ...base[field],
    ...(overlay[field]?.after ?? []),
  ];
  return {
    setup: mergeField("setup"),
    teardown: mergeField("teardown"),
    run: mergeField("run"),
  };
}
