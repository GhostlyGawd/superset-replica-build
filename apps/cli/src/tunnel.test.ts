import { describe, expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildPairUrl, parseRemoteOptions } from "./index.ts";
import { pidAlive } from "./proc.ts";
import { startTunnel } from "./tunnel.ts";

/**
 * Phase-5 W3 (ADR-0017) proof for the remote-path tunnel manager. A real public
 * cloudflared/localtunnel tunnel CANNOT run deterministically in CI, so this drives
 * `startTunnel` against a COMMITTED STUB binary (`__fixtures__/stub-tunnel.mjs`) via
 * the explicit `command` seam — NOT a user-path mock: the real binary is what runs on
 * every user path; the stub only stands in for "a tunnel process that prints a URL
 * then idles" so the manager's parse + tree-kill + bounded-error behavior is testable.
 *
 * We assert: (1) the public HTTPS URL is parsed from the stub's output; (2) `stop()`
 * genuinely kills the stub process tree (PID dead); (3) a missing binary and a binary
 * that never prints a URL both yield bounded, honest errors (no hang, no leak); and
 * (4) the `--remote` URL-builder threads the tunnel URL into the QR payload with the
 * bearer never present.
 */

const STUB = fileURLToPath(new URL("./__fixtures__/stub-tunnel.mjs", import.meta.url));

/** Poll until `pid` is dead or the bound elapses (death is not synchronous). */
async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      return true;
    }
    await delay(100);
  }
  return !pidAlive(pid);
}

describe("@swarm/cli — tunnel manager (stub-binary seam, no real network)", () => {
  test("parses the public HTTPS URL from the tunnel process output", async () => {
    const tunnel = await startTunnel({
      port: 0,
      command: { bin: process.execPath, args: [STUB] },
      timeoutMs: 5000,
    });
    try {
      expect(tunnel.url).toBe("https://test-xyz.trycloudflare.com");
      expect(tunnel.provider).toBe("cloudflared");
      expect(tunnel.pid).toBeGreaterThan(0);
    } finally {
      tunnel.stop();
    }
  }, 10_000);

  test("stop() tree-kills the tunnel process — the PID is genuinely dead", async () => {
    const tunnel = await startTunnel({
      port: 0,
      command: { bin: process.execPath, args: [STUB] },
      timeoutMs: 5000,
    });
    const pid = tunnel.pid ?? -1;
    expect(pidAlive(pid)).toBe(true);
    tunnel.stop();
    expect(await waitDead(pid, 6000)).toBe(true);
  }, 12_000);

  test("a missing tunnel binary yields a bounded, honest error", async () => {
    const start = Date.now();
    await expect(
      startTunnel({
        port: 0,
        command: { bin: "grove-definitely-not-a-real-tunnel-binary-xyz", args: [] },
        timeoutMs: 4000,
      }),
    ).rejects.toThrow(/not installed|not on PATH|failed to start/i);
    // ENOENT surfaces fast — well under the timeout (never a hang).
    expect(Date.now() - start).toBeLessThan(4000);
  }, 10_000);

  test("a binary that never prints a URL times out with a bounded error", async () => {
    await expect(
      startTunnel({
        port: 0,
        command: { bin: process.execPath, args: [STUB], env: { STUB_NO_URL: "1" } },
        timeoutMs: 700,
      }),
    ).rejects.toThrow(/did not print a public URL/i);
  }, 10_000);

  test("--remote threads the tunnel URL into the QR payload; the bearer never appears", () => {
    const tunnelUrl = "https://test-abc-123.trycloudflare.com";
    const code = "ABCD-2468";
    const url = buildPairUrl(tunnelUrl, code);

    expect(url).toBe(`${tunnelUrl}/?code=${code}`);
    expect(url).toContain(tunnelUrl);
    expect(url).toContain(code);
    // The QR carries only the tunnel origin + single-use code (ADR-0014).
    expect(url.toLowerCase()).not.toContain("bearer");
    expect(url.toLowerCase()).not.toContain("token");
  });

  test("parseRemoteOptions lifts --remote/--provider and forwards daemon flags", () => {
    const parsed = parseRemoteOptions(["--remote", "--provider", "localtunnel", "--port", "0"]);
    expect(parsed.remote).toBe(true);
    expect(parsed.provider).toBe("localtunnel");
    expect(parsed.forwarded).toEqual(["--port", "0"]);

    const none = parseRemoteOptions(["--db", "/tmp/x"]);
    expect(none.remote).toBe(false);
    expect(none.provider).toBeUndefined();
    expect(none.forwarded).toEqual(["--db", "/tmp/x"]);
  });
});
