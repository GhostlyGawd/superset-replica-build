import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "@swarm/db/store";
import { PgliteEventLogStore, startHost } from "@swarm/host/daemon";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { EventLog } from "@swarm/sync";
import { BASE_URL, E2E_PORT, PAIR_FILE, type PairFixture, setTestHost } from "./host-fixture.ts";

const MOBILE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PWA_DIST = join(MOBILE_ROOT, "dist");

/** Build the PWA so the host has real, current assets to serve. */
function buildPwa(): void {
  execFileSync("node", ["./node_modules/vite/bin/vite.js", "build"], {
    cwd: MOBILE_ROOT,
    stdio: "ignore",
    windowsHide: true,
  });
}

/** Mint a single-use pairing code by calling the bearer-gated `pair.start` over HTTP. */
async function mintPairCode(endpoint: string, token: string): Promise<string> {
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

/**
 * Boot a REAL Grove host that ALSO serves the built PWA same-origin (ADR-0014),
 * seeded with a project + two worktrees, then mint a single-use pairing code. The
 * spec drives the pairing screen with that code → asserts the real workspace list
 * renders. No mocks: genuine static serve + tRPC + `/sync`.
 */
async function globalSetup(): Promise<void> {
  buildPwa();
  if (!existsSync(join(PWA_DIST, "index.html"))) {
    throw new Error(`PWA build missing at ${PWA_DIST}`);
  }

  const stamp = Date.now();
  const dataDir = join(tmpdir(), `grove-mobile-e2e-pg-${stamp}`);
  const manifestDir = join(tmpdir(), `grove-mobile-e2e-host-${stamp}`);
  mkdirSync(manifestDir, { recursive: true });

  const store = await openStore({ dataDir });
  const project = await store.createProject({
    name: "superset-replica",
    localPath: join(dataDir, "repo"),
    defaultBranch: "main",
  });
  await store.createWorkspace({
    projectId: project.id,
    name: "feat/login-rework",
    branch: "feat/login",
    baseBranch: "main",
    worktreePath: join(dataDir, "wt", "login"),
    status: "running",
  });
  const second = await store.createWorkspace({
    projectId: project.id,
    name: "fix/api-timeout",
    branch: "fix/api",
    baseBranch: "main",
    worktreePath: join(dataDir, "wt", "api"),
    status: "idle",
  });

  const eventLog = new EventLog(new PgliteEventLogStore(store, "grove-mobile-e2e"));
  const supervisor = new PtySupervisor();
  const host = await startHost({
    store,
    eventLog,
    supervisor,
    host: "127.0.0.1",
    port: E2E_PORT,
    manifestDir,
    heartbeatMs: 0,
    worktreesRoot: join(dataDir, "worktrees"),
    pwaDir: PWA_DIST,
  });

  // One live transition so the PWA's `/sync` subscription has an event to fold in.
  await eventLog.append({
    type: "workspace.status_changed",
    workspaceId: second.id,
    status: "needs_attention",
  });

  const code = await mintPairCode(host.endpoint, host.token);
  const fixture: PairFixture = { url: BASE_URL, code };
  writeFileSync(PAIR_FILE, JSON.stringify(fixture), "utf8");
  setTestHost({ host, store, dataDir, manifestDir });
}

export default globalSetup;
