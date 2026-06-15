/**
 * `@swarm/host/daemon` — the heavy, Node-only engine surface: the running HTTP +
 * tRPC + WS host, the orchestrator (worktrees → PTYs → events), and the
 * PGlite-backed event-log store. Importing this pulls in node-pty, PGlite and
 * Hono, so it lives behind a subpath the browser-safe `.` entry never reaches
 * (the `createHost` handle stays light for thin clients).
 */
export { HOST_VERSION } from "./version.ts";
export {
  startHost,
  runDaemon,
  defaultManifestPath,
  type StartHostOptions,
  type RunDaemonOptions,
  type RunningHost,
  type HostManifest,
} from "./server.ts";
export {
  Orchestrator,
  type OrchestratorDeps,
  type CreateWorkspaceInput,
  type StartAgentOptions,
  type PreparedWorkspace,
  type AgentRun,
} from "./orchestrator.ts";
export { PgliteEventLogStore } from "./pglite-event-log-store.ts";
export {
  PairingStore,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  normalizeCode,
  type PairingCode,
  type PairingRedeemResult,
  type PairingStoreOptions,
} from "./pair.ts";
export {
  createAppRouter,
  createAppCaller,
  osName,
  defaultShellFor,
  type AppRouter,
  type HostContext,
  type HostServices,
  type OsName,
} from "./trpc.ts";
export {
  openExternal,
  EXTERNAL_LAUNCH_CAPTURE_ENV,
  type ExternalTarget,
  type LaunchSpec,
} from "./open-external.ts";
export { probeGitRepo, type RepoInfo } from "./repo-probe.ts";
export {
  createTerminalServer,
  type TerminalServer,
  type TerminalServerOptions,
  type TerminalClientFrame,
  type TerminalServerFrame,
} from "./terminal-server.ts";
