/**
 * @swarm/agent-adapters — run real CLI coding agents in a PTY, stream their
 * output, and infer status (spec §2, P03; monitoring feeds P01/P04).
 *
 * Layers:
 *  - `descriptors`      built-in adapter descriptors (Claude Code, Codex CLI,
 *                       Cursor Agent, Gemini CLI, + zero-config generic).
 *  - `status`           pure output -> `AgentStatus` inference (the shared enum).
 *  - `terminal-adapter` the universal adapter: launch any CLI in a supervisor PTY.
 *  - `presets`          named presets (detection + env) + install detection.
 *  - `mock-adapter`     headless keyless agent behind an explicit flag (tests/dev).
 *
 * No node-pty import lives here: the adapter takes a `@swarm/pty-supervisor`
 * handle by type and the supervisor runs under Node (ADR-0007a), so the bundle
 * stays free of native deps.
 */

export const AGENT_ADAPTERS_VERSION = "0.1.0";

export * from "./descriptors.ts";
export * from "./status.ts";
export * from "./terminal-adapter.ts";
export * from "./presets.ts";
export * from "./mock-protocol.ts";
export * from "./mock-adapter.ts";
