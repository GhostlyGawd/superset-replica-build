import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@swarm/db/store";
import { PgliteEventLogStore, startHost } from "@swarm/host/daemon";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { CONN_FILE, setTestHost } from "./host-fixture.ts";

/** Run git synchronously during fixture setup; throws on failure (setup must be sound). */
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

/**
 * A real on-disk git working tree with one committed file and an uncommitted edit,
 * so the diff viewer (P06) has a genuine working-tree-vs-HEAD diff to render and the
 * terminal (P05) has a real cwd to spawn in. Returns the worktree path.
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
  // Uncommitted edit → a real modified-file diff for the viewer.
  writeFileSync(
    join(dir, "greeter.ts"),
    "export function greet(name) {\n  return `Hi, ${name}!`;\n}\n",
  );
  return dir;
}

/**
 * Start a REAL Grove host on a loopback port, seeded directly over the engine's
 * store with a project + two worktrees, then emit one live status transition so
 * the renderer's sync subscription is exercised end-to-end. The connected spec
 * reads `{endpoint, token}` from CONN_FILE and injects it, so the renderer makes
 * genuine tRPC + WebSocket calls against this host.
 */
async function globalSetup(): Promise<void> {
  const stamp = Date.now();
  const dataDir = join(tmpdir(), `grove-e2e-pg-${stamp}`);
  const manifestDir = join(tmpdir(), `grove-e2e-host-${stamp}`);
  mkdirSync(manifestDir, { recursive: true });

  const store = await openStore({ dataDir });
  const project = await store.createProject({ name: "superset-replica", defaultBranch: "main" });
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

  // A third worktree backed by a REAL git working tree on disk — the Phase-3
  // content features (terminal + diff) attach to this one in the content spec.
  const realWorktree = makeRealWorktree(join(dataDir, "wt", "real"));
  await store.createWorkspace({
    projectId: project.id,
    name: "chore/diff-demo",
    branch: "chore/diff",
    baseBranch: "main",
    worktreePath: realWorktree,
    status: "idle",
  });

  const hostId = asId<"HostId">(`grove-e2e-${stamp}`);
  const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
  const supervisor = new PtySupervisor();
  const host = await startHost({
    store,
    eventLog,
    supervisor,
    hostId,
    host: "127.0.0.1",
    port: 0,
    manifestDir,
    heartbeatMs: 0,
  });

  // One live transition over the sync log so the subscribe path delivers an event.
  await eventLog.append({
    type: "workspace.status_changed",
    workspaceId: second.id,
    status: "needs_attention",
  });

  writeFileSync(CONN_FILE, JSON.stringify({ endpoint: host.endpoint, token: host.token }), "utf8");
  setTestHost({ host, store, dataDir, manifestDir });
}

export default globalSetup;
