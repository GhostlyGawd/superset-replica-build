import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PtySupervisor, SHELL_KINDS, resolveShell } from "./index";

const WORKER = fileURLToPath(new URL("./pty-worker.ts", import.meta.url));

// node-pty cannot run under Bun on Windows (ConPTY pipe -> ERR_SOCKET_CLOSED,
// ADR-0007), so the real spawn/stream/resize/tree-kill round-trip is exercised
// in a NODE child process. Bun (the test runtime) only orchestrates + asserts.
const SHELLS =
  process.platform === "win32" ? (["powershell", "cmd"] as const) : (["bash"] as const);

describe("@swarm/pty-supervisor contracts", () => {
  test("resolveShell covers every ShellKind", () => {
    for (const kind of SHELL_KINDS) {
      const resolved = resolveShell(kind);
      expect(resolved.file.length).toBeGreaterThan(0);
      expect(Array.isArray(resolved.args)).toBe(true);
    }
  });

  test("kill() of an unknown pty id is a no-op", async () => {
    const supervisor = new PtySupervisor();
    await expect(supervisor.kill("pty_missing" as never)).resolves.toBeUndefined();
    expect(supervisor.list()).toHaveLength(0);
  });
});

describe("@swarm/pty-supervisor integration (real PTY on host, via Node)", () => {
  for (const shell of SHELLS) {
    test(`spawns ${shell}, streams output, resizes, and tree-kills the process tree`, () => {
      const result = spawnSync("node", [WORKER, shell], {
        encoding: "utf8",
        // Generous: the worker polls (with bounded deadlines) for the grandchild
        // to spawn and for the tree to die, which is slow when several ConPTY
        // suites run at once under a cold `turbo --force` (ADR-0011).
        timeout: 150_000,
      });
      const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      // Surface worker output on failure for debuggability.
      expect(out, out).toContain("WORKER_RESULT=PASS");
      expect(result.status).toBe(0);
    }, 160_000);
  }
});
