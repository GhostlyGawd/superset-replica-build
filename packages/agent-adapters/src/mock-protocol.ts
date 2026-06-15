/**
 * Shared constants for the headless mock agent. Imported by the fake CLI script
 * (run under Node inside a PTY), the mock adapter, and the integration test, so
 * the deterministic tokens stay in lock-step across all three.
 */

/** Banner token the fake CLI prints once at startup; the test asserts on it. */
export const MOCK_OUTPUT_TOKEN = "SWARM-MOCK-AGENT";

/** Final line the fake CLI prints right before exiting cleanly. */
export const MOCK_DONE_MARKER = "__SWARM_MOCK_DONE__";

/** Default file the fake CLI writes into its working dir, for the diff viewer. */
export const MOCK_DEFAULT_FILENAME = "AGENT_OUTPUT.md";

/** First line of the written file, so the test can assert real content landed. */
export const MOCK_FILE_HEADING = "# Swarm mock agent run";
