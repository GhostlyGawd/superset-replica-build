import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_TOOLS,
  type ToolSpec,
  formatDepTable,
  verifyDeps,
  verifyTool,
} from "./dep-verify.ts";
import { daemonStatus, runStop, runUp } from "./index.ts";

/**
 * Phase-5 W2 (ADR-0015) proof for `grove up`. Two parts, no mocks on user paths:
 *
 *   1. dep-verify UNIT — drives the REAL `execFile` probe against a present tool
 *      (`node`, definitely runnable) and a bogus binary name, asserting ✓/✗ without
 *      a throw. These are genuine process executions, not stubs.
 *   2. A REAL `grove up` → status(RUNNING) → stop(STOPPED) round-trip behind the
 *      `GROVE_HOME` + `--db <temp>` + `--port 0` seam (NOT a mock — daemon and CLI
 *      resolve the same throwaway home), asserting the daemon truly came up (store +
 *      bearer + VAPID created on boot, `/healthz` answers) and a pair code was minted.
 *      Bounded + deterministic; the leading space in the prefix forces a spaced path.
 */

describe("@swarm/cli — dep-verify (real execFile, cross-platform, no mocks)", () => {
  test("a present tool reports ✓ with a parsed version", async () => {
    const node: ToolSpec = {
      bin: "node",
      label: "Node.js",
      required: true,
      versionArgs: ["--version"],
      minMajor: 18,
      installHint: "n/a",
    };
    const check = await verifyTool(node);
    expect(check.found).toBe(true);
    expect(check.ok).toBe(true);
    expect(check.major).not.toBeNull();
    expect(check.major ?? 0).toBeGreaterThanOrEqual(18);
    // Real `execFile` version probe; can run past bun's 5s default body timeout under
    // heavy parallel `turbo` load — give it headroom. Assertions unchanged.
  }, 60_000);

  test("a bogus tool path reports ✗ and never throws", async () => {
    const bogus: ToolSpec = {
      bin: "grove-definitely-not-a-real-binary-xyz",
      label: "Bogus",
      required: true,
      versionArgs: ["--version"],
      installHint: "n/a",
    };
    const check = await verifyTool(bogus); // must resolve, never reject
    expect(check.found).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.version).toBeNull();
    // The missing-binary probe walks PATH and can run past bun's 5s default body
    // timeout under heavy parallel `turbo` load — give it headroom. Assertions unchanged.
  }, 60_000);

  test("verifyDeps fails on a present-but-too-old required tool, but never on an optional miss", async () => {
    const tooNew: ToolSpec = {
      bin: "node",
      label: "Node.js",
      required: true,
      versionArgs: ["--version"],
      minMajor: 999,
      installHint: "n/a",
    };
    const report = await verifyDeps([tooNew]);
    expect(report.ok).toBe(false);
    expect(report.missingRequired).toHaveLength(1);

    const optionalMissing: ToolSpec = {
      bin: "grove-not-real-optional",
      label: "opt-tool",
      required: false,
      versionArgs: ["--version"],
      installHint: "n/a",
    };
    const okReport = await verifyDeps([optionalMissing]);
    expect(okReport.ok).toBe(true);
    expect(formatDepTable(okReport)).toContain("opt-tool");
    // Two real `execFile` probes; can run past bun's 5s default body timeout under
    // heavy parallel `turbo` load — give it headroom. Assertions unchanged.
  }, 60_000);

  test("the real default toolchain (node/bun/git) verifies green here", async () => {
    const report = await verifyDeps(DEFAULT_TOOLS);
    expect(report.ok).toBe(true);
    const required = report.checks.filter((check) => check.spec.required);
    for (const check of required) {
      expect(check.found).toBe(true);
    }
    // Probes the whole default toolchain (node/bun/git) via real `execFile`; can run
    // past bun's 5s default body timeout under load — give it headroom. Assertions unchanged.
  }, 60_000);
});

const TMP_PREFIX = join(tmpdir(), "grove cli-up-");

let home: string;
let dbDir: string;
let up: Awaited<ReturnType<typeof runUp>>;
const priorHome = process.env.GROVE_HOME;

beforeAll(() => {
  home = mkdtempSync(TMP_PREFIX);
  dbDir = join(home, "pg");
  process.env.GROVE_HOME = home;
});

afterAll(async () => {
  try {
    await runStop();
  } catch {
    // best-effort cleanup of a daemon left by a mid-way failure
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

describe("@swarm/cli — grove up (dep preflight + start + pair), real round-trip", () => {
  test("--check runs the preflight only and starts nothing", async () => {
    const result = await runUp(["--check", "--db", dbDir, "--port", "0"]);
    expect(result.dryRun).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.depReport.ok).toBe(true);
    expect(result.started).toBeNull();
    expect(result.paired).toBeNull();
    const status = await daemonStatus();
    expect(status.running).toBe(false);
  }, 20_000);

  test("grove up boots the daemon (store + bearer + VAPID), mints a pair code, /healthz ok", async () => {
    up = await runUp(["--db", dbDir, "--port", "0"]);
    expect(up.ok).toBe(true);
    expect(up.started?.alreadyRunning).toBe(false);
    expect(up.started?.pid ?? 0).toBeGreaterThan(0);

    // The endpoint genuinely answers — not just a manifest on disk.
    const res = await fetch(`${up.started?.endpoint}/healthz`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);

    // A single-use pairing code was really minted.
    expect(up.paired?.code).toBeTruthy();
    expect((up.paired?.code ?? "").length).toBeGreaterThan(0);

    // The host created/loaded its store, bearer (manifest) and VAPID keypair on boot.
    const manifestFile = join(home, "host", "manifest.json");
    const vapidFile = join(home, "host", "vapid.json");
    expect(existsSync(manifestFile)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { token?: string };
    expect((manifest.token ?? "").length).toBeGreaterThan(0);
    expect(existsSync(vapidFile)).toBe(true);
    expect(existsSync(dbDir)).toBe(true);
  }, 60_000);

  test("grove up is idempotent — a second up attaches, never double-starts", async () => {
    const again = await runUp(["--db", dbDir, "--port", "0"]);
    expect(again.ok).toBe(true);
    expect(again.started?.alreadyRunning).toBe(true);
    expect(again.started?.pid).toBe(up.started?.pid);
  }, 30_000);

  test("status shows RUNNING, then stop tears it down (PID dead, status stopped)", async () => {
    const status = await daemonStatus();
    expect(status.running).toBe(true);

    const stop = await runStop();
    expect(stop.wasRunning).toBe(true);
    expect(stop.stopped).toBe(true);
    expect(() => process.kill(up.started?.pid ?? -1, 0)).toThrow();

    const after = await daemonStatus();
    expect(after.running).toBe(false);
  }, 30_000);
});
