import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "@swarm/db/store";
import type { RunningHost } from "@swarm/host/daemon";

/**
 * Fixed loopback port the REAL host (which ALSO serves the built PWA same-origin,
 * ADR-0014) binds for the phone-viewport e2e. The Playwright `baseURL` points here,
 * so the browser loads the PWA from the very origin its tRPC + `/sync` calls target.
 */
export const E2E_PORT = 4319;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** Where globalSetup writes the minted single-use code + URL for the pairing spec. */
export const PAIR_FILE = join(tmpdir(), "grove-mobile-e2e-pair.json");

export interface PairFixture {
  readonly url: string;
  /** A pre-minted single-use code for the pairing spec. */
  readonly code: string;
  /**
   * The host bearer. A spec acts as the `grove pair` OPERATOR with it — minting its
   * OWN fresh single-use code per test (codes are single-use, so tests cannot share
   * one). The browser still only obtains the token via `pair.redeem`, never directly.
   */
  readonly token: string;
}

/** Mint a fresh single-use pairing code via the bearer-gated `pair.start` (the CLI's path). */
export async function mintPairCode(endpoint: string, token: string): Promise<string> {
  const res = await fetch(`${endpoint}/trpc/pair.start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`pair.start failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { result?: { data?: { code?: string } } };
  const code = body.result?.data?.code;
  if (!code) {
    throw new Error("pair.start returned no code");
  }
  return code;
}

export interface TestHostHandle {
  readonly host: RunningHost;
  readonly store: Store;
  readonly dataDir: string;
  readonly manifestDir: string;
}

let current: TestHostHandle | undefined;

export function setTestHost(handle: TestHostHandle): void {
  current = handle;
}

/** Deterministic teardown: release the host + store, then remove temp dirs + files. */
export async function teardownTestHost(): Promise<void> {
  if (!current) {
    return;
  }
  const { host, store, dataDir, manifestDir } = current;
  current = undefined;
  await host.close();
  await store.close();
  for (const path of [dataDir, manifestDir]) {
    rmSync(path, { recursive: true, force: true });
  }
  rmSync(PAIR_FILE, { force: true });
}
