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
  readonly code: string;
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
