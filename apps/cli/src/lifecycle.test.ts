import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonStatus, runStart, runStatus, runStop } from "./index.ts";

/**
 * Phase-5 W1 (ADR-0015) proof: a REAL `grove start` → `status` → `stop` round-trip
 * against the actual host daemon — no mocks. `runStart` spawns the daemon DETACHED
 * under Node (node-pty cannot run under Bun, ADR-0007a); this Bun test drives the
 * CLI lifecycle functions in-process and asserts the daemon is genuinely reachable,
 * then tree-killed (ADR-0011).
 *
 * Isolation seam (NOT a mock): `GROVE_HOME` relocates the host home (manifest +
 * VAPID) into a throwaway temp dir, and `--db <temp>` points PGlite there, so the
 * round-trip never touches the user's real `~/.grove`. The spawned daemon inherits
 * `GROVE_HOME`, so daemon and CLI client agree on the manifest path. `--port 0`
 * binds an ephemeral port the daemon records in the manifest.
 *
 * A leading space in the temp prefix forces every path to contain a space (the
 * Windows `C:\\Users\\John Doe` hazard).
 */
const TMP_PREFIX = join(tmpdir(), "grove cli-lifecycle-");

let home: string;
let dbDir: string;
let started: { endpoint: string; pid: number };
const priorHome = process.env.GROVE_HOME;

beforeAll(() => {
  home = mkdtempSync(TMP_PREFIX);
  dbDir = join(home, "pg");
  process.env.GROVE_HOME = home;
});

afterAll(async () => {
  // Stop a daemon left behind by a mid-way failure, then restore env + temp dir.
  try {
    await runStop();
  } catch {
    // best-effort
  }
  if (priorHome === undefined) {
    Reflect.deleteProperty(process.env, "GROVE_HOME");
  } else {
    process.env.GROVE_HOME = priorHome;
  }
  try {
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // A leftover temp dir (Windows file lock) must never fail the run.
  }
  // Teardown (graceful→forced tree-kill + bounded Windows `rm` retries) can run
  // past bun's 5 s default hook timeout under heavy parallel `turbo` load, so give
  // it explicit headroom — the assertions themselves are unchanged.
}, 30_000);

describe("@swarm/cli — real daemon lifecycle (start → status → stop, detached Node host)", () => {
  test("grove start launches a detached Node daemon that answers /healthz", async () => {
    const result = await runStart(["--port", "0", "--db", dbDir]);
    started = { endpoint: result.endpoint, pid: result.pid };
    expect(result.alreadyRunning).toBe(false);
    expect(result.pid).toBeGreaterThan(0);
    // Genuinely reachable over HTTP, not just a manifest on disk.
    const res = await fetch(`${result.endpoint}/healthz`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  }, 60_000);

  test("grove status reports RUNNING for the live daemon", async () => {
    const status = await daemonStatus();
    expect(status.running).toBe(true);
    expect(status.endpoint).toBe(started.endpoint);
    expect(status.pid).toBe(started.pid);
    await runStatus(); // exercise the print path too
  }, 20_000);

  test("grove start is idempotent — reports the live daemon, never double-starts", async () => {
    const again = await runStart(["--port", "0", "--db", dbDir]);
    expect(again.alreadyRunning).toBe(true);
    expect(again.pid).toBe(started.pid);
  }, 20_000);

  test("grove stop tree-kills the daemon; PID is dead and status shows stopped", async () => {
    const stop = await runStop();
    expect(stop.wasRunning).toBe(true);
    expect(stop.stopped).toBe(true);
    expect(stop.pid).toBe(started.pid);
    // The PID is genuinely gone (signal 0 throws ESRCH).
    expect(() => process.kill(started.pid, 0)).toThrow();
    // And status now reads stopped (manifest cleared).
    const status = await daemonStatus();
    expect(status.running).toBe(false);
  }, 30_000);
});
