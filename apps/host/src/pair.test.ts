import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PairingStore } from "./pair.ts";
import { runWorker } from "./spawn-worker.ts";

/**
 * Two layers of proof for the ADR-0014 pairing model:
 *   1. PairingStore unit tests (under Bun, deterministic via an injected clock):
 *      single-use, TTL expiry, brute-force lockout, code shape.
 *   2. A REAL host HTTP round-trip in a spawned Node child (node-pty can't run under
 *      Bun on Windows, ADR-0007a): start → redeem → an authenticated `workspaces.list`
 *      with the redeemed bearer succeeds, and reused/bad codes + the bearer guard hold.
 */

describe("PairingStore (single-use codes — security core)", () => {
  test("a fresh code redeems exactly once, then is invalid (single-use)", () => {
    const store = new PairingStore();
    const { code } = store.issue();
    const first = store.redeem(code);
    expect(first.ok).toBe(true);
    const second = store.redeem(code);
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({ reason: "invalid" });
  });

  test("a minted code is 8 chars from the unambiguous alphabet (no 0/O/1/I/L/U)", () => {
    const store = new PairingStore();
    for (let i = 0; i < 200; i += 1) {
      const { code } = store.issue();
      expect(code).toMatch(/^[2-9A-HJ-NP-TV-Z]{8}$/);
    }
  });

  test("a code expires after its TTL (injected clock)", () => {
    let now = 1_000_000;
    const store = new PairingStore({ ttlMs: 60_000, now: () => now });
    const { code } = store.issue();
    now += 59_000;
    // Still valid just before expiry...
    const ok = store.redeem(code);
    expect(ok.ok).toBe(true);

    const { code: code2 } = store.issue();
    now += 61_000; // ...but not after the TTL elapses.
    const expired = store.redeem(code2);
    expect(expired.ok).toBe(false);
    expect(expired).toMatchObject({ reason: "invalid" });
  });

  test("normalizes user input (case + spacing) before matching", () => {
    const store = new PairingStore();
    const { code } = store.issue();
    const spaced = `${code.slice(0, 4)} ${code.slice(4).toLowerCase()}`;
    expect(store.redeem(spaced).ok).toBe(true);
  });

  test("locks out after repeated bad attempts (brute-force guard)", () => {
    let now = 0;
    const store = new PairingStore({ maxFailedRedeems: 3, lockoutMs: 30_000, now: () => now });
    const { code } = store.issue();

    // Three consecutive bad guesses trip the lockout.
    expect(store.redeem("AAAAAAAA")).toMatchObject({ ok: false, reason: "invalid" });
    expect(store.redeem("AAAAAAAA")).toMatchObject({ ok: false, reason: "invalid" });
    expect(store.redeem("AAAAAAAA")).toMatchObject({ ok: false, reason: "invalid" });

    // Now even the CORRECT code is refused while locked.
    const locked = store.redeem(code);
    expect(locked).toMatchObject({ ok: false, reason: "locked" });

    // After the cooldown the correct code works again.
    now += 31_000;
    expect(store.redeem(code).ok).toBe(true);
  });
});

const WORKER = fileURLToPath(new URL("./pair-worker.ts", import.meta.url));
const TMP_PREFIX = join(tmpdir(), "grove pair-");

interface PairReport {
  startNoAuthStatus: number;
  startStatus: number;
  codeLength: number;
  redeemStatus: number;
  redeemTokenMatches: boolean;
  hasResumeToken: boolean;
  authedListStatus: number;
  authedListCount: number;
  reusedRedeemStatus: number;
  badRedeemStatus: number;
  unauthListStatus: number;
}

let root: string;
let out: string;
let exitStatus: number | null;
let report: PairReport | undefined;

beforeAll(async () => {
  root = mkdtempSync(TMP_PREFIX);
  const result = await runWorker("node", [WORKER, root], 120_000);
  out = result.out;
  exitStatus = result.status;
  const begin = out.indexOf("HOST_REPORT_BEGIN");
  const end = out.indexOf("HOST_REPORT_END");
  if (begin >= 0 && end > begin) {
    report = JSON.parse(out.slice(begin + "HOST_REPORT_BEGIN".length, end)) as PairReport;
  }
}, 150_000);

afterAll(async () => {
  if (root) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // best-effort: a leftover temp dir must never fail the run.
    }
  }
  // Forced + retried Windows `rm` of the real-host worker's data dir can exceed bun's
  // 5s default hook timeout under heavy parallel `turbo` load; give it headroom so a
  // slow cleanup is a slow PASS, never a contention timeout. Assertions unchanged.
}, 60_000);

describe("@swarm/host — pairing round-trip over real HTTP (real host, via Node)", () => {
  test("the pair worker run passed end-to-end", () => {
    expect(out, out).toContain("WORKER_RESULT=PASS");
    expect(exitStatus).toBe(0);
    expect(report).toBeDefined();
  });

  test("pair.start is bearer-gated; redeem is public and yields the bearer", () => {
    expect(report?.startNoAuthStatus).toBe(401);
    expect(report?.startStatus).toBe(200);
    expect(report?.codeLength).toBe(8);
    expect(report?.redeemStatus).toBe(200);
    expect(report?.redeemTokenMatches).toBe(true);
    expect(report?.hasResumeToken).toBe(true);
  });

  test("the redeemed bearer authenticates a real tRPC call (workspaces.list)", () => {
    expect(report?.authedListStatus).toBe(200);
    expect(report?.authedListCount).toBeGreaterThanOrEqual(1);
  });

  test("a reused or bogus code is rejected, and the guard still bites unauth'd calls", () => {
    expect(report?.reusedRedeemStatus).toBe(401);
    expect(report?.badRedeemStatus).toBe(401);
    expect(report?.unauthListStatus).toBe(401);
  });
});
