import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOCK_ADAPTER_ENABLED_ENV,
  MOCK_DEFAULT_FILENAME,
  MOCK_DONE_MARKER,
  MOCK_FILE_HEADING,
  MOCK_OUTPUT_TOKEN,
  type PtyHost,
  fakeCliPath,
  isMockAdapterEnabled,
  launchMockAgent,
} from "./index.ts";

const WORKER = fileURLToPath(new URL("./mock-worker.ts", import.meta.url));

// A host that explodes if touched — proves the disabled guard short-circuits
// before any PTY work happens.
const failingHost = {
  spawn: () => {
    throw new Error("supervisor must not be used while the mock adapter is disabled");
  },
  onData: () => () => {},
  write: () => {},
  kill: async () => {},
} as unknown as PtyHost;

describe("mock adapter gating (never on a user happy path)", () => {
  const prior = process.env[MOCK_ADAPTER_ENABLED_ENV];
  afterEach(() => {
    if (prior === undefined) {
      delete process.env[MOCK_ADAPTER_ENABLED_ENV];
    } else {
      process.env[MOCK_ADAPTER_ENABLED_ENV] = prior;
    }
  });

  test("disabled by default", () => {
    delete process.env[MOCK_ADAPTER_ENABLED_ENV];
    expect(isMockAdapterEnabled()).toBe(false);
  });

  test("enabled by the explicit env flag or call flag", () => {
    process.env[MOCK_ADAPTER_ENABLED_ENV] = "1";
    expect(isMockAdapterEnabled()).toBe(true);
    delete process.env[MOCK_ADAPTER_ENABLED_ENV];
    expect(isMockAdapterEnabled(true)).toBe(true);
  });

  test("launching while disabled throws instead of faking a run", () => {
    delete process.env[MOCK_ADAPTER_ENABLED_ENV];
    expect(() =>
      launchMockAgent({
        supervisor: failingHost,
        workspaceId: "ws_x" as never,
        cwd: tmpdir(),
      }),
    ).toThrow(/disabled/i);
  });

  test("the fake CLI script it launches exists on disk", () => {
    expect(fakeCliPath().endsWith("fake-cli.ts")).toBe(true);
    expect(existsSync(fakeCliPath())).toBe(true);
  });
});

describe("mock adapter integration (real PTY via Node worker)", () => {
  let workDir: string | undefined;
  afterEach(() => {
    if (workDir !== undefined) {
      rmSync(workDir, { recursive: true, force: true });
      workDir = undefined;
    }
  });

  test("spawns -> streams deterministic output -> makes a file change -> running->done", () => {
    // Space in the path exercises the Windows "C:\\Users\\John Doe" hazard.
    workDir = mkdtempSync(join(tmpdir(), "grove mock-"));
    const result = spawnSync("node", [WORKER, workDir], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    // Worker self-verdict (surfaces detail on failure for debuggability).
    expect(out, out).toContain("WORKER_RESULT=PASS");
    expect(result.status).toBe(0);

    // Assert on the REAL streamed PTY bytes (between the worker's markers),
    // proving deterministic output actually streamed through the supervisor.
    const stream = out.slice(out.indexOf("WORKER_STREAM_BEGIN"), out.indexOf("WORKER_STREAM_END"));
    expect(stream).toContain(MOCK_OUTPUT_TOKEN);
    expect(stream).toContain(MOCK_DONE_MARKER);

    // Status transitioned running -> done, and the file change landed.
    expect(out).toMatch(/statuses=running(\|[a-z_]+)*\|done|statuses=running\|done/);
    expect(out).toContain("final=done");

    // Independent assertion that the agent actually changed a file on disk.
    const written = join(workDir, MOCK_DEFAULT_FILENAME);
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain(MOCK_FILE_HEADING);
  }, 35_000);
});
