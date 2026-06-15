import { fileURLToPath } from "node:url";
import type { ShellKind } from "@swarm/pty-supervisor";
import type { PtyId, WorkspaceId } from "@swarm/shared";
import { MOCK_DEFAULT_FILENAME, MOCK_DONE_MARKER } from "./mock-protocol.ts";
import type { AgentStatus, StatusDetection } from "./status.ts";
import { type PtyHost, type TerminalHandle, launchTerminalAdapter } from "./terminal-adapter.ts";

/**
 * Headless mock adapter (spec §6.1 — a real feature behind a flag, NEVER on a
 * user happy path). It drives the bundled `fake-cli` script in a real PTY under
 * Node, giving the integration/e2e suite a keyless agent that streams
 * deterministic output, makes a file change, and exits cleanly to `done`.
 *
 * Disabled by default. Enable per-call with `enable: true`, or process-wide by
 * setting the env flag below — so it can never silently activate in production.
 */
export const MOCK_ADAPTER_ENABLED_ENV = "SWARM_ENABLE_MOCK_ADAPTER";

/** The fake CLI never goes quiet long enough to look idle; done comes from exit. */
const MOCK_DETECTION: StatusDetection = {
  idleMs: 30_000,
  promptPatterns: [],
  donePatterns: [new RegExp(MOCK_DONE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))],
  errorPatterns: [/ failed:/],
};

/** True when the mock adapter is explicitly enabled (call flag or env flag). */
export function isMockAdapterEnabled(enable?: boolean): boolean {
  if (enable === true) {
    return true;
  }
  const flag = process.env[MOCK_ADAPTER_ENABLED_ENV];
  return flag === "1" || flag === "true";
}

/** Absolute path to the fake CLI script this adapter launches. */
export function fakeCliPath(): string {
  return fileURLToPath(new URL("./fake-cli.ts", import.meta.url));
}

export interface MockAgentOptions {
  readonly supervisor: PtyHost;
  readonly workspaceId: WorkspaceId;
  /** The worktree the fake CLI writes its file into. */
  readonly cwd: string;
  readonly shell?: ShellKind;
  /** Explicit opt-in; overrides the env flag. */
  readonly enable?: boolean;
  /** File the fake CLI creates (default `AGENT_OUTPUT.md`). */
  readonly fileName?: string;
  /** Length of the simulated working phase in ms (default 600). */
  readonly workMs?: number;
  readonly onData?: (chunk: string) => void;
  readonly onStatus?: (status: AgentStatus) => void;
}

export interface MockAgentHandle extends TerminalHandle {
  readonly ptyId: PtyId;
  /** Absolute path of the file the fake CLI will create. */
  readonly outputFile: string;
}

/**
 * Launch the keyless mock agent in a real PTY. Throws if the adapter is not
 * explicitly enabled — refusing to run is the honest default, never a faked
 * success on a user path.
 */
export function launchMockAgent(options: MockAgentOptions): MockAgentHandle {
  if (!isMockAdapterEnabled(options.enable)) {
    throw new Error(
      `Mock adapter is disabled. Set ${MOCK_ADAPTER_ENABLED_ENV}=1 or pass enable:true (test/dev only).`,
    );
  }
  const fileName = options.fileName ?? MOCK_DEFAULT_FILENAME;
  const workMs = options.workMs ?? 600;
  const outputFile = `${options.cwd.replace(/\\/g, "/")}/${fileName}`;
  const handle = launchTerminalAdapter({
    supervisor: options.supervisor,
    workspaceId: options.workspaceId,
    command: "node",
    args: [fakeCliPath(), "--file", fileName, "--work-ms", String(workMs)],
    cwd: options.cwd,
    shell: options.shell,
    detection: MOCK_DETECTION,
    onData: options.onData,
    onStatus: options.onStatus,
  });
  return {
    ...handle,
    ptyId: handle.ptyId,
    outputFile,
  };
}
