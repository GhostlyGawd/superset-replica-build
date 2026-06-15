import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "@swarm/db/store";
import { PgliteEventLogStore, startHost } from "@swarm/host/daemon";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { EventLog } from "@swarm/sync";
import {
  BASE_URL,
  E2E_PORT,
  PAIR_FILE,
  type PairFixture,
  mintPairCode,
  setTestHost,
} from "./host-fixture.ts";

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

/** Run git synchronously during fixture setup; throws on failure (setup must be sound). */
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

/**
 * A real on-disk git working tree on a feature branch off `main`, with one committed
 * file and an uncommitted edit — so the phone's read-only diff (W3) renders a genuine
 * working-tree-vs-HEAD diff and `workspaces.gitStatus` returns a real branch +
 * ahead/behind. Returns the worktree path.
 */
function makeRealWorktree(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "grove@example.com");
  git(dir, "config", "user.name", "Grove Test");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(
    join(dir, "greeter.ts"),
    "export function greet(name) {\n  return 'Hello, ' + name;\n}\n",
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "init");
  git(dir, "checkout", "-b", "feat/diff-demo");
  // Uncommitted edit → a real modified-file diff for the read-only viewer.
  writeFileSync(
    join(dir, "greeter.ts"),
    "export function greet(name) {\n  return `Hi, ${name}!`;\n}\n",
  );
  return dir;
}

/**
 * Boot a REAL Grove host that ALSO serves the built PWA same-origin (ADR-0014),
 * seeded with a project + three worktrees (one backed by a real git checkout with a
 * live agent session), then mint a single-use pairing code. The specs drive the
 * pairing screen with that code → assert the real workspace list, the worktree
 * detail, the live agents, and a real file diff render. No mocks: genuine static
 * serve + tRPC + `/sync` + git.
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

  // A third worktree backed by a REAL git working tree on disk — the W3 read
  // journeys (workspace detail git status, read-only diff) attach to this one. It
  // also carries a live agent session so the Agents tab + detail have real data.
  const realWorktree = makeRealWorktree(join(dataDir, "wt", "real"));
  const demo = await store.createWorkspace({
    projectId: project.id,
    name: "diff-demo",
    branch: "feat/diff-demo",
    baseBranch: "main",
    worktreePath: realWorktree,
    status: "running",
  });
  await store.createSession({
    workspaceId: demo.id,
    adapterId: "claude-code",
    mode: "terminal",
    status: "running",
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
  // It ALSO drives the host's Web Push send path (W5): the subscriber records a
  // `needs_attention` notification row (no device is subscribed yet, so nothing is
  // pushed) — the real row the push e2e's inbox renders + marks read. A brief settle
  // lets that async record land before the specs run.
  await eventLog.append({
    type: "workspace.status_changed",
    workspaceId: second.id,
    status: "needs_attention",
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const code = await mintPairCode(host.endpoint, host.token);
  const fixture: PairFixture = { url: BASE_URL, code, token: host.token };
  writeFileSync(PAIR_FILE, JSON.stringify(fixture), "utf8");
  setTestHost({ host, store, dataDir, manifestDir });
}

export default globalSetup;
