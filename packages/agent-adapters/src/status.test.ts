import { describe, expect, test } from "bun:test";
import {
  type AgentStatus,
  DEFAULT_DETECTION,
  EXIT_SENTINEL,
  isTerminal,
  nextFromIdle,
  nextFromOutput,
  scanOutput,
} from "./status.ts";
import { buildLaunchLine } from "./terminal-adapter.ts";

describe("scanOutput", () => {
  test("detects the exit sentinel with a zero code", () => {
    const signals = scanOutput(`done\n${EXIT_SENTINEL}:0\n`, DEFAULT_DETECTION);
    expect(signals.sawExit).toBe(true);
    expect(signals.exitCode).toBe(0);
  });

  test("detects a non-zero exit code", () => {
    const signals = scanOutput(`${EXIT_SENTINEL}:137`, DEFAULT_DETECTION);
    expect(signals.sawExit).toBe(true);
    expect(signals.exitCode).toBe(137);
  });

  test("ignores the echoed (unexpanded) sentinel from shell input echo", () => {
    // The shell echoes the input line before running it; that form has no digits.
    const signals = scanOutput(`Write-Host "${EXIT_SENTINEL}:$LASTEXITCODE"`, DEFAULT_DETECTION);
    expect(signals.sawExit).toBe(false);
    expect(signals.exitCode).toBeNull();
  });

  test("recognises a y/n prompt as waiting for input", () => {
    expect(scanOutput("Proceed? (y/n)", DEFAULT_DETECTION).sawPrompt).toBe(true);
  });

  test("plain progress output carries no terminal signals", () => {
    const signals = scanOutput("compiling module 3/10", DEFAULT_DETECTION);
    expect(signals.sawExit).toBe(false);
    expect(signals.sawError).toBe(false);
    expect(signals.sawDone).toBe(false);
    expect(signals.sawPrompt).toBe(false);
  });
});

describe("nextFromOutput", () => {
  const sig = (over: Partial<ReturnType<typeof scanOutput>>) => ({
    sawExit: false,
    exitCode: null,
    sawError: false,
    sawDone: false,
    sawPrompt: false,
    ...over,
  });

  test("exit code 0 -> done and terminal", () => {
    const t = nextFromOutput("running", false, sig({ sawExit: true, exitCode: 0 }));
    expect(t).toEqual({ status: "done", finished: true });
  });

  test("non-zero exit -> error and terminal", () => {
    const t = nextFromOutput("running", false, sig({ sawExit: true, exitCode: 2 }));
    expect(t).toEqual({ status: "error", finished: true });
  });

  test("error pattern -> error and terminal", () => {
    const t = nextFromOutput("running", false, sig({ sawError: true }));
    expect(t).toEqual({ status: "error", finished: true });
  });

  test("prompt -> needs_attention, not terminal", () => {
    const t = nextFromOutput("running", false, sig({ sawPrompt: true }));
    expect(t).toEqual({ status: "needs_attention", finished: false });
  });

  test("done pattern -> done but resumable (not terminal)", () => {
    const t = nextFromOutput("running", false, sig({ sawDone: true }));
    expect(t).toEqual({ status: "done", finished: false });
  });

  test("plain output keeps it running", () => {
    expect(nextFromOutput("needs_attention", false, sig({})).status).toBe("running");
  });

  test("a finished agent is sticky regardless of later output", () => {
    const t = nextFromOutput("done", true, sig({ sawError: true, sawExit: true, exitCode: 1 }));
    expect(t).toEqual({ status: "done", finished: true });
  });
});

describe("nextFromIdle", () => {
  test("a quiet running agent flips to needs_attention", () => {
    expect(nextFromIdle("running", false)).toBe("needs_attention");
  });

  test("a finished agent never flips on idle", () => {
    expect(nextFromIdle("running", true)).toBe("running");
    expect(nextFromIdle("done", true)).toBe("done");
  });

  test("a waiting agent stays waiting", () => {
    expect(nextFromIdle("needs_attention", false)).toBe("needs_attention");
  });
});

describe("isTerminal", () => {
  const cases: ReadonlyArray<readonly [AgentStatus, boolean]> = [
    ["running", false],
    ["needs_attention", false],
    ["done", true],
    ["error", true],
  ];
  for (const [status, expected] of cases) {
    test(`${status} -> ${expected}`, () => {
      expect(isTerminal(status)).toBe(expected);
    });
  }
});

describe("buildLaunchLine", () => {
  test("powershell quotes tokens, injects env, and appends the exit echo", () => {
    const line = buildLaunchLine("powershell", "node", ["C:/Users/John Doe/agent.js", "--flag"], {
      FOO: "bar",
    });
    expect(line).toContain("$env:FOO='bar';");
    expect(line).toContain("& 'node' 'C:/Users/John Doe/agent.js' '--flag'");
    expect(line).toContain(`Write-Host "${EXIT_SENTINEL}:$LASTEXITCODE"`);
  });

  test("cmd uses ERRORLEVEL for the exit echo", () => {
    const line = buildLaunchLine("cmd", "claude", ["--print"], {});
    expect(line).toContain(`echo ${EXIT_SENTINEL}:%ERRORLEVEL%`);
  });

  test("posix shells single-quote tokens and echo $?", () => {
    const line = buildLaunchLine("bash", "gemini", ["chat"], { KEY: "v" });
    expect(line).toContain("KEY='v'");
    expect(line).toContain("'gemini' 'chat'");
    expect(line).toContain(`echo "${EXIT_SENTINEL}:$?"`);
  });
});
