import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "@swarm/db/store";
import type { RunningHost } from "@swarm/host/daemon";

/** Where globalSetup writes the live `{endpoint, token}` for the test workers. */
export const CONN_FILE = join(tmpdir(), "grove-e2e-conn.json");

/** Open-in-external test seam: the host appends each launch it WOULD perform here
 *  (one JSON line) instead of spawning a real GUI app, so the e2e can assert it. */
export const EXTERNAL_CAPTURE_FILE = join(tmpdir(), "grove-e2e-external.log");

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

/** Deterministic teardown: release the host (sync + http + orchestrator), close
 *  the store, then remove the temp data/manifest dirs and the conn file. */
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
  rmSync(CONN_FILE, { force: true });
  rmSync(EXTERNAL_CAPTURE_FILE, { force: true });
}
