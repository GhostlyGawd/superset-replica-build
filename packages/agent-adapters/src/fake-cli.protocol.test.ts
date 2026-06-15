import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MOCK_DEFAULT_FILENAME,
  MOCK_DONE_MARKER,
  MOCK_FILE_HEADING,
  MOCK_OUTPUT_TOKEN,
} from "./mock-protocol.ts";

/**
 * `fake-cli.mjs` is plain JavaScript (ADR-0011: Node-executed-in-PTY scripts carry
 * no TypeScript), so it cannot import the `.ts` protocol constants and instead
 * inlines them. This test pins them in lock-step with `mock-protocol.ts` — the
 * source of truth — so a future edit to one without the other fails CI.
 */
const SOURCE = readFileSync(fileURLToPath(new URL("./fake-cli.mjs", import.meta.url)), "utf8");

describe("fake-cli.mjs protocol constants stay in lock-step with mock-protocol.ts", () => {
  test.each([
    ["MOCK_OUTPUT_TOKEN", MOCK_OUTPUT_TOKEN],
    ["MOCK_DONE_MARKER", MOCK_DONE_MARKER],
    ["MOCK_DEFAULT_FILENAME", MOCK_DEFAULT_FILENAME],
    ["MOCK_FILE_HEADING", MOCK_FILE_HEADING],
  ])("fake-cli.mjs declares %s with the canonical value", (name, value) => {
    expect(SOURCE).toContain(`const ${name} = ${JSON.stringify(value)};`);
  });
});
