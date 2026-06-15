import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { asId } from "@swarm/shared";
import type { HostId, ProjectId } from "@swarm/shared";
import { openStore } from "./store";
import type { Store } from "./store";

/**
 * Real persistence test (no mocks): open a PGlite store in a temp data dir,
 * apply migrations on open, exercise CRUD + the append-event/read-from-seq path,
 * then close and clean up. Path handling goes through node:path so this passes
 * on the Windows host (no hardcoded "/").
 */

const HOST = asId<"HostId">("host_test") as HostId;
let dir: string;
let store: Store;

beforeAll(async () => {
  // Cross-platform temp dir; the trailing separator is supplied by node, not "/".
  dir = mkdtempSync(path.join(tmpdir(), "swarm-db-"));
  store = await openStore({ dataDir: dir });
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("@swarm/db store — migrations + CRUD", () => {
  let projectId: ProjectId;

  test("a fresh store is migrated and empty", async () => {
    expect(await store.listProjects()).toEqual([]);
    expect(await store.maxSeq()).toBe(0);
  });

  test("project CRUD round-trips", async () => {
    const created = await store.createProject({
      name: "grove",
      repoUrl: "https://github.com/x/y",
      defaultBranch: "main",
    });
    projectId = created.id;
    expect(created.id).toMatch(/^prj_/);
    expect(created.name).toBe("grove");
    expect(created.localPath).toBeNull();

    const fetched = await store.getProject(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(await store.listProjects()).toHaveLength(1);
  });

  test("workspace CRUD + status projection", async () => {
    const ws = await store.createWorkspace({
      projectId,
      name: "feature-a",
      branch: "feat/a",
      baseBranch: "main",
      worktreePath: "repos/grove/.worktrees/feat-a",
    });
    expect(ws.status).toBe("idle");

    const running = await store.setWorkspaceStatus(ws.id, "running");
    expect(running.status).toBe("running");
    expect(running.lastActivityAt >= ws.lastActivityAt).toBe(true);

    const renamed = await store.renameWorkspace(ws.id, "feature-a-renamed");
    expect(renamed.name).toBe("feature-a-renamed");

    expect(await store.listWorkspaces(projectId)).toHaveLength(1);
  });

  test("agent preset upsert + session lifecycle", async () => {
    const preset = await store.upsertPreset({
      name: "Claude Code",
      adapterId: "claude",
      command: "claude",
      args: ["--print"],
      env: { FOO: "bar" },
    });
    expect(preset.id).toMatch(/^pst_/);
    expect(preset.args).toEqual(["--print"]);

    // upsert by id updates in place (no duplicate row)
    const updated = await store.upsertPreset({ ...preset, name: "Claude Code 2", id: preset.id });
    expect(updated.name).toBe("Claude Code 2");
    expect(await store.listPresets()).toHaveLength(1);

    const ws = (await store.listWorkspaces(projectId))[0];
    if (!ws) throw new Error("expected a workspace");
    const session = await store.createSession({
      workspaceId: ws.id,
      adapterId: "claude",
      mode: "terminal",
      presetId: preset.id,
      pid: 4242,
    });
    expect(session.status).toBe("starting");

    const ended = await store.endSession(session.id, 0);
    expect(ended.status).toBe("exited");
    expect(ended.exitCode).toBe(0);
    expect(ended.endedAt).not.toBeNull();
    expect(await store.listSessions(ws.id)).toHaveLength(1);
  });

  test("sync cursor ack/get", async () => {
    expect(await store.getCursor("client-1")).toBe(0);
    await store.ackCursor("client-1", 7);
    expect(await store.getCursor("client-1")).toBe(7);
    await store.ackCursor("client-1", 12);
    expect(await store.getCursor("client-1")).toBe(12);
  });
});

describe("@swarm/db event log — monotonic seq, ordering, no gaps", () => {
  test("append assigns a strictly increasing, gapless seq and reads back ordered", async () => {
    const ws = (await store.listWorkspaces())[0];
    if (!ws) throw new Error("expected a workspace from earlier setup");

    const base = await store.maxSeq();
    const N = 64;
    const appended: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const ev = await store.appendEvent({
        hostId: HOST,
        type: `evt.${i}`,
        payload: { i, note: "real append" },
        actor: "test",
        workspaceId: ws.id,
      });
      appended.push(ev.seq);
    }

    // seq is a real number, strictly increasing by exactly 1 (single-writer: no gaps).
    expect(appended[0]).toBe(base + 1);
    for (let i = 1; i < appended.length; i += 1) {
      const prev = appended[i - 1];
      const cur = appended[i];
      if (prev === undefined || cur === undefined) throw new Error("missing seq");
      expect(cur - prev).toBe(1);
    }
    expect(appended[appended.length - 1]).toBe(base + N);
    expect(await store.maxSeq()).toBe(base + N);

    // read-from-seq for sync: everything after the pre-append high-water mark.
    const all = await store.readEventsFromSeq(base);
    expect(all).toHaveLength(N);
    const readSeqs = all.map((e) => e.seq);
    expect(readSeqs).toEqual([...readSeqs].sort((a, b) => a - b)); // ordered ascending
    for (let i = 1; i < readSeqs.length; i += 1) {
      const prev = readSeqs[i - 1];
      const cur = readSeqs[i];
      if (prev === undefined || cur === undefined) throw new Error("missing seq");
      expect(cur - prev).toBe(1); // no gaps
    }
    // payload survives the jsonb round-trip
    expect(all[0]?.payload).toEqual({ i: 0, note: "real append" });

    // resume from a mid-stream cursor returns exactly the tail, still ordered.
    const cursor = appended[9];
    if (cursor === undefined) throw new Error("missing cursor");
    const tail = await store.readEventsFromSeq(cursor);
    expect(tail).toHaveLength(N - 10);
    expect(tail[0]?.seq).toBe(cursor + 1);

    // limit + host filter (per-host tailing).
    const limited = await store.readEventsFromSeq(base, { hostId: HOST, limit: 5 });
    expect(limited).toHaveLength(5);
    expect(limited.map((e) => e.seq)).toEqual([base + 1, base + 2, base + 3, base + 4, base + 5]);
  });
});
