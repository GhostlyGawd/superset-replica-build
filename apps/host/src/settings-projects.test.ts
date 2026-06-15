import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "@swarm/db/store";
import type { Store } from "@swarm/db/store";
import type { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { Orchestrator } from "./orchestrator.ts";
import { PairingStore } from "./pair.ts";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { type HostServices, createAppCaller, osName } from "./trpc.ts";
import { HOST_VERSION } from "./version.ts";

/**
 * Real in-process round-trips for the wave-B2 host procedures (settings hotkeys +
 * projects.open). Uses the tRPC caller over a REAL PGlite store and a REAL git
 * repo on disk — no HTTP/WS, so it runs under Bun (no node-pty: the orchestrator's
 * supervisor is never touched on these paths). P09 persistence + P08 open-project
 * validation are exercised end-to-end.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function makeRepo(repoPath: string): void {
  mkdirSync(repoPath, { recursive: true });
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.email", "grove@example.com");
  git(repoPath, "config", "user.name", "Grove Test");
  git(repoPath, "config", "commit.gpgsign", "false");
  git(repoPath, "config", "core.autocrlf", "false");
  writeFileSync(join(repoPath, "README.md"), "hello\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-m", "init");
}

let root: string;
let repoPath: string;
let store: Store;
let caller: ReturnType<typeof createAppCaller>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "grove-b2-"));
  repoPath = join(root, "repo");
  makeRepo(repoPath);

  store = await openStore({ dataDir: join(root, "pg") });
  const hostId = asId<"HostId">("grove-b2-host");
  const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
  // The supervisor is never used by settings/projects.open, so a stub keeps the
  // test free of node-pty (which cannot load under Bun on Windows, ADR-0007a).
  const supervisor = { killAll: async () => {} } as unknown as PtySupervisor;
  const orchestrator = new Orchestrator({
    store,
    eventLog,
    supervisor,
    worktreesRoot: join(root, "worktrees"),
  });
  const services: HostServices = {
    store,
    eventLog,
    orchestrator,
    hostId,
    version: HOST_VERSION,
    os: osName(),
    deviceName: "grove-b2",
    owner: "",
    endpoint: () => "http://127.0.0.1:0",
    token: "test-bearer",
    pairing: new PairingStore(),
    vapidPublicKey: "test-vapid-public-key",
  };
  caller = createAppCaller(services);
});

afterAll(async () => {
  await store?.close();
  if (root) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("@swarm/host wave-B2 procedures (settings + projects.open), real round-trip", () => {
  test("settings.getHotkeys starts empty", async () => {
    expect(await caller.settings.getHotkeys()).toEqual([]);
  });

  test("setHotkey persists and overwrites the same action in place (P09)", async () => {
    await caller.settings.setHotkey({ actionId: "workspace.next", binding: "Ctrl+Alt+KeyJ" });
    expect(await caller.settings.getHotkeys()).toEqual([
      { actionId: "workspace.next", binding: "Ctrl+Alt+KeyJ" },
    ]);
    // Rebinding the same action must keep ONE row (the delete-then-insert upsert).
    await caller.settings.setHotkey({ actionId: "workspace.next", binding: "Ctrl+Alt+KeyK" });
    expect(await caller.settings.getHotkeys()).toEqual([
      { actionId: "workspace.next", binding: "Ctrl+Alt+KeyK" },
    ]);
  });

  test("setHotkeys (bulk) + resetHotkey + resetHotkeys", async () => {
    await caller.settings.setHotkeys({
      bindings: [
        { actionId: "terminal.newTab", binding: "Ctrl+Shift+KeyT" },
        { actionId: "settings.open", binding: "Ctrl+Comma" },
      ],
    });
    expect((await caller.settings.getHotkeys()).length).toBe(3);

    await caller.settings.resetHotkey({ actionId: "workspace.next" });
    const after = await caller.settings.getHotkeys();
    expect(after.length).toBe(2);
    expect(after.some((h) => h.actionId === "workspace.next")).toBe(false);

    await caller.settings.resetHotkeys();
    expect(await caller.settings.getHotkeys()).toEqual([]);
  });

  test("projects.open validates a REAL git repo and seeds an isolated worktree (P08)", async () => {
    const result = await caller.projects.open({ path: repoPath });
    expect(result.project.name).toBe("repo");
    expect(result.project.localPath).toBeTruthy();
    expect(result.workspace.projectId).toBe(result.project.id);
    expect(result.workspace.baseBranch).toBe("main");
    // The worktree physically exists on disk on the host.
    expect(existsSync(result.workspace.worktreePath)).toBe(true);
    expect(existsSync(join(result.workspace.worktreePath, "README.md"))).toBe(true);
  });

  test("projects.open reuses the project for the same repo root", async () => {
    const first = (await caller.projects.list())[0];
    expect(first).toBeDefined();
    const again = await caller.projects.open({ path: repoPath });
    expect(first?.id).toBe(again.project.id);
    expect(await caller.projects.list()).toHaveLength(1);
  });

  test("projects.open rejects a non-repo path", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain, { recursive: true });
    await expect(caller.projects.open({ path: plain })).rejects.toThrow();
    await expect(caller.projects.open({ path: join(root, "does-not-exist") })).rejects.toThrow();
  });
});
