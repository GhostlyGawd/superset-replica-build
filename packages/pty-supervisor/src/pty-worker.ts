/**
 * pty-worker — runs UNDER NODE (never Bun: node-pty's ConPTY pipe throws
 * ERR_SOCKET_CLOSED under Bun on Windows, ADR-0007). Spawned by the integration
 * test, it drives the real PtySupervisor through spawn -> stream -> resize ->
 * tree-kill and prints a single `WORKER_RESULT=...` line the test asserts on.
 *
 * argv[2] = ShellKind. Proves token streaming, ANSI passthrough, resize, and
 * that the whole process tree (incl. a sleeping grandchild) is dead after kill().
 */
import { execSync } from "node:child_process";
import { asId } from "@swarm/shared";
import type { WorkspaceId } from "@swarm/shared";
import { PtySupervisor, SHELL_KINDS, type ShellKind } from "./index.ts";

const TOKEN = "grove-pty-ok";
const ESC = String.fromCharCode(27); // build CSI prefix without a literal control char in source

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  if (process.platform === "win32") {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: "utf8" });
      return out.includes(String(pid));
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Per-shell command: echo the token + spawn a long-lived grandchild, printing its PID where possible. */
function recipe(shell: ShellKind): string {
  switch (shell) {
    case "powershell":
    case "pwsh":
      return `Write-Host '${TOKEN}'; $c = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep 120'; Write-Host ("CHILDPID=" + $c.Id)`;
    case "cmd":
      return `echo ${TOKEN} & start /b "" cmd /c "ping -n 120 127.0.0.1 >nul"`;
    default:
      return `echo ${TOKEN}; sleep 120 & echo "CHILDPID=$!"`;
  }
}

async function main(): Promise<number> {
  const raw = process.argv[2] ?? "";
  if (!SHELL_KINDS.includes(raw as ShellKind)) {
    console.log(`WORKER_RESULT=FAIL reason=unknown-shell:${raw}`);
    return 1;
  }
  const shell = raw as ShellKind;

  const supervisor = new PtySupervisor();
  let buf = "";
  const session = supervisor.spawn({
    workspaceId: asId<"WorkspaceId">("ws_probe") as WorkspaceId,
    shell,
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  });
  supervisor.onData(session.ptyId, (data) => {
    buf += data;
  });
  const rootPid = supervisor.pidOf(session.ptyId);

  await delay(700);
  supervisor.resize(session.ptyId, 120, 40);

  supervisor.write(session.ptyId, `${recipe(shell)}\r`);
  await delay(3000);

  const match = buf.match(/CHILDPID=(\d+)/);
  const childPid = match?.[1] ? Number(match[1]) : null;
  const tokenSeen = buf.includes(TOKEN);
  const ansiSeen = buf.includes(`${ESC}[`); // ESC[ (CSI) => VT/ANSI passthrough
  const childAliveBefore = childPid !== null ? pidAlive(childPid) : null;

  await supervisor.kill(session.ptyId);
  await delay(1500);

  const rootGone = rootPid !== undefined ? !pidAlive(rootPid) : false;
  const childGone = childPid !== null ? !pidAlive(childPid) : true;
  const pass = tokenSeen && rootGone && childGone;

  console.log(
    `WORKER_DETAIL shell=${shell} rootPid=${rootPid} childPid=${childPid} ` +
      `token=${tokenSeen} ansi=${ansiSeen} childAliveBefore=${childAliveBefore} ` +
      `rootGone=${rootGone} childGone=${childGone}`,
  );
  console.log(`WORKER_RESULT=${pass ? "PASS" : "FAIL"}`);
  return pass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`WORKER_RESULT=FAIL reason=${reason}`);
    process.exit(1);
  },
);
