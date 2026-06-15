import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { type RunningHost, defaultManifestPath, runDaemon } from "@swarm/host/daemon";
import qrcode from "qrcode-terminal";
import { type DepReport, formatDepTable, verifyDeps } from "./dep-verify.ts";

/**
 * @swarm/cli — the `grove` command-line entrypoint (spec §2, P13). Verb parsing
 * is real from Phase 0; `grove host` starts the real headless daemon in the
 * FOREGROUND (Phase 2, debugging); `grove pair` bootstraps the mobile PWA (Phase 4,
 * ADR-0014). Phase-5 W1 (ADR-0015) wires the daemon LIFECYCLE — `grove start`
 * (detached background daemon under Node, ADR-0007a), `grove stop` (tree-kill by
 * manifest PID, ADR-0011) and `grove status` (real liveness probe). Phase-5 W2
 * adds `grove up` — the one-command bootstrap that COMPOSES a cross-platform dep
 * preflight → idempotent `start` (boots the daemon → store + bearer + VAPID) →
 * mint + print the pairing QR.
 */

export const CLI_VERSION = "0.1.0";

export const CLI_COMMANDS = [
  "up",
  "start",
  "stop",
  "status",
  "host",
  "pair",
  "projects",
  "workspaces",
  "auth",
] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export interface ParsedInvocation {
  readonly command: CliCommand;
  readonly args: readonly string[];
}

function isCliCommand(value: string): value is CliCommand {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

/** Parse `grove <command> [args]` into a typed invocation. */
export function parseArgv(argv: readonly string[]): ParsedInvocation {
  const first = argv[0] ?? "status";
  if (!isCliCommand(first)) {
    throw new Error(`Unknown grove command: ${first}`);
  }
  return { command: first, args: argv.slice(1) };
}

export interface HostArgs {
  readonly port?: number;
  readonly dataDir?: string;
  /** Bind address; loopback by default for privacy (P11). `--lan` ⇒ `0.0.0.0`. */
  readonly host?: string;
}

/**
 * Read `--port`/`--db`/`--host`/`--lan` flags off the `grove host` args. LAN binding
 * is an explicit opt-in (ADR-0014 decision 3): default stays `127.0.0.1` (P11); a
 * `--lan` flag (or `--host 0.0.0.0`) is required to expose the host on the network.
 */
export function parseHostArgs(args: readonly string[]): HostArgs {
  let port: number | undefined;
  let dataDir: string | undefined;
  let host: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--port" && value !== undefined) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0) {
        port = parsed;
      }
      i += 1;
    } else if (flag === "--db" && value !== undefined) {
      dataDir = value;
      i += 1;
    } else if (flag === "--host" && value !== undefined) {
      host = value;
      i += 1;
    } else if (flag === "--lan") {
      host = "0.0.0.0";
    }
  }
  return { port, dataDir, host };
}

/**
 * Start the real host daemon and report where it bound + its manifest. The
 * listening server keeps the process alive; the returned handle lets a caller
 * (or test) shut it down. Must run under Node (the engine drives node-pty,
 * ADR-0007a).
 */
export async function runHost(args: readonly string[] = []): Promise<RunningHost> {
  const { port, dataDir, host: bindHost } = parseHostArgs(args);
  const host = await runDaemon({ port, dataDir, host: bindHost });
  console.log(
    `grove host listening on ${host.endpoint} (ws ${host.wsUrl})\nmanifest: ${host.manifestPath}`,
  );
  if (bindHost && bindHost !== "127.0.0.1" && bindHost !== "localhost") {
    const lan = lanAddress();
    console.log(
      `LAN binding ENABLED (${bindHost}). Reachable on your network${lan ? ` at http://${lan}:${host.port}` : ""}.`,
    );
    console.log("Run 'grove pair --lan' to link a phone over the network.");
  }
  return host;
}

interface PairStartResponse {
  readonly result?: { readonly data?: { code: string; endpoint: string; expiresAt: string } };
}

/** Call the bearer-gated `pair.start` over HTTP to mint a single-use code. */
async function fetchPairCode(
  endpoint: string,
  token: string,
): Promise<{ code: string; endpoint: string; expiresAt: string }> {
  const res = await fetch(`${endpoint}/trpc/pair.start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`pair.start failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as PairStartResponse;
  const data = body.result?.data;
  if (!data) {
    throw new Error("pair.start returned no data");
  }
  return data;
}

/** First non-internal IPv4 address, for the LAN URL printed by `grove pair --lan`. */
function lanAddress(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

/** Swap a loopback endpoint's host for the LAN IP so a phone can reach it. */
function toLanEndpoint(endpoint: string): string {
  const lan = lanAddress();
  if (!lan) {
    return endpoint;
  }
  const url = new URL(endpoint);
  url.hostname = lan;
  return url.origin;
}

/**
 * `grove pair [--lan]` — mint a single-use pairing code from the running host and
 * print it as a scannable terminal QR plus text (ADR-0014). The QR encodes the
 * host URL + the *code* (never the bearer); the PWA reads `?code=` to auto-fill.
 * `--lan` rewrites the URL to the host's LAN IP (requires `grove host --lan`).
 * Returns the minted code + the URL it rendered, so `grove up` can fold it into a
 * single bootstrap summary (and a test can assert a real code was minted).
 */
export async function runPair(
  args: readonly string[] = [],
): Promise<{ code: string; endpoint: string; url: string }> {
  const lan = args.includes("--lan");
  const manifestPath = defaultManifestPath();
  let manifest: { endpoint: string; token: string };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      endpoint: string;
      token: string;
    };
  } catch {
    throw new Error(
      `No running host found (expected manifest at ${manifestPath}). Start one with 'grove host'.`,
    );
  }

  const minted = await fetchPairCode(manifest.endpoint, manifest.token);
  const displayEndpoint = lan ? toLanEndpoint(minted.endpoint) : minted.endpoint;
  const url = `${displayEndpoint}/?code=${minted.code}`;

  qrcode.generate(url, { small: true }, (rendered) => process.stdout.write(`${rendered}\n`));
  console.log(`Pairing code:  ${minted.code}`);
  console.log(`On your phone: ${url}`);
  console.log(`Expires:       ${minted.expiresAt}`);
  console.log("The bearer token is NOT in the QR — only this one-time code is.");
  if (lan && displayEndpoint === minted.endpoint) {
    console.log("(No LAN address detected; showing the loopback URL.)");
  }
  if (!lan) {
    console.log(
      "Tip: 'grove host --lan' then 'grove pair --lan' to pair a phone over your network.",
    );
  }
  return { code: minted.code, endpoint: displayEndpoint, url };
}

// ──────────────────────────────────────────────────────────────────────────
// Phase-5 W1 — real daemon lifecycle (ADR-0015): start (detached) / stop / status.
// ──────────────────────────────────────────────────────────────────────────

/** This module's path on disk — re-invoked under Node to run the detached daemon. */
const SELF_PATH = fileURLToPath(import.meta.url);
/** Per-probe `/healthz` timeout. */
const HEALTHZ_TIMEOUT_MS = 1500;
/** How long `start` waits for the spawned daemon to become reachable. */
const START_POLL_TIMEOUT_MS = 30_000;
/** Max detached-spawn attempts before `start` gives up (transient boot-crash retry). */
const START_MAX_ATTEMPTS = 3;
/** Grace window for each kill stage in `stop` before escalating / giving up. */
const STOP_GRACE_MS = 4000;

/** The on-disk handshake the running host writes (`@swarm/host` HostManifest). */
interface DaemonManifest {
  readonly endpoint: string;
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
}

/** Read + parse the host manifest, or `null` when there is no running host. */
function readManifest(): DaemonManifest | null {
  try {
    return JSON.parse(readFileSync(defaultManifestPath(), "utf8")) as DaemonManifest;
  } catch {
    return null;
  }
}

/**
 * Cross-platform "is this PID alive?". Signal `0` probes a process without
 * delivering a signal: it throws `ESRCH` when the PID is gone and `EPERM` when the
 * process exists but is owned by another user (⇒ alive).
 */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Probe the unauthenticated `/healthz` liveness endpoint with a bounded timeout. */
async function healthzOk(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/healthz`, {
      signal: AbortSignal.timeout(HEALTHZ_TIMEOUT_MS),
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** The daemon MUST run under Node, never Bun (node-pty, ADR-0007a). */
function nodeBin(): string {
  // Under Node, reuse the exact running binary; under Bun, resolve `node` off PATH.
  return process.versions.bun ? "node" : process.execPath;
}

/**
 * Terminate a daemon process TREE by PID (ADR-0011). On Windows there is no
 * deliverable graceful signal for a windowless detached process, so `taskkill /T`
 * (whole tree) is used — without `/F` for the graceful pass, with `/F` to force. On
 * POSIX the daemon is spawned `detached` (its own process group), so a negative PID
 * delivers the signal to the WHOLE group (the daemon + every PTY it spawned), with a
 * single-PID fallback when the group is already gone.
 */
function treeKill(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    const args = ["/pid", String(pid), "/t"];
    if (signal === "SIGKILL") {
      args.push("/f");
    }
    spawnSync("taskkill", args, { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone — killing is best-effort.
    }
  }
}

/** Human-friendly uptime from the manifest's ISO `startedAt`. */
function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "unknown";
  }
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}h${m}m${s}s`;
  }
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export interface DaemonStatus {
  readonly running: boolean;
  readonly endpoint: string | null;
  readonly pid: number | null;
  readonly startedAt: string | null;
  readonly detail: string;
}

/**
 * Resolve real daemon liveness: the manifest must exist, its PID must be alive, AND
 * `/healthz` must answer. Honest about every degraded case (no manifest, stale
 * manifest, process up but endpoint silent).
 */
export async function daemonStatus(): Promise<DaemonStatus> {
  const manifest = readManifest();
  if (!manifest) {
    return { running: false, endpoint: null, pid: null, startedAt: null, detail: "no manifest" };
  }
  if (!pidAlive(manifest.pid)) {
    return {
      running: false,
      endpoint: manifest.endpoint,
      pid: manifest.pid,
      startedAt: manifest.startedAt,
      detail: "stale manifest (process not alive)",
    };
  }
  const healthy = await healthzOk(manifest.endpoint);
  return {
    running: healthy,
    endpoint: manifest.endpoint,
    pid: manifest.pid,
    startedAt: manifest.startedAt,
    detail: healthy ? "healthy" : "process alive but endpoint not responding",
  };
}

/** `grove status` — print real daemon liveness (running/unhealthy/stopped + uptime). */
export async function runStatus(): Promise<DaemonStatus> {
  const status = await daemonStatus();
  if (status.running && status.endpoint && status.startedAt) {
    console.log(
      `grove daemon: RUNNING  endpoint=${status.endpoint} pid=${status.pid} uptime=${formatUptime(status.startedAt)}`,
    );
  } else if (status.detail === "process alive but endpoint not responding" && status.endpoint) {
    console.log(
      `grove daemon: UNHEALTHY  pid=${status.pid} alive but ${status.endpoint} not responding`,
    );
  } else {
    console.log(`grove daemon: STOPPED (${status.detail})`);
  }
  return status;
}

export interface StartResult {
  readonly endpoint: string;
  readonly pid: number;
  readonly alreadyRunning: boolean;
}

/**
 * `grove start [--port N] [--db DIR] [--host H | --lan]` — start the host daemon
 * DETACHED so the CLI returns while the host keeps running. The daemon is exactly
 * what `grove host` runs (`runDaemon`), but re-invoked as a NODE child (node-pty
 * cannot run under Bun — ADR-0007a): `node <cli> host <args>` with `detached: true`
 * + `unref()` so it outlives this process, stdio redirected to a log file. The child
 * writes the manifest (incl. its own PID); we poll `/healthz` until reachable, then
 * print the endpoint + a `grove pair` hint. Idempotent: a live daemon (PID alive +
 * `/healthz` ok) is reported, never double-started.
 */
export async function runStart(args: readonly string[] = []): Promise<StartResult> {
  const existing = readManifest();
  if (existing && pidAlive(existing.pid) && (await healthzOk(existing.endpoint))) {
    console.log(
      `grove daemon already running at ${existing.endpoint} (pid ${existing.pid}). Use 'grove stop' to stop it.`,
    );
    return { endpoint: existing.endpoint, pid: existing.pid, alreadyRunning: true };
  }

  const hostDir = dirname(defaultManifestPath());
  mkdirSync(hostDir, { recursive: true });
  const logPath = join(hostDir, "daemon.log");
  const knownPid = existing?.pid;

  // Bounded retry on an EARLY-EXIT only: under heavy parallel load on Windows the
  // daemon boot can crash on transient filesystem contention (PGlite data dir / VAPID
  // write — the ADR-0011 file-lock class), which a re-spawn rides out. A hang/timeout
  // is NOT retried (it would mask a real stall); it surfaces immediately.
  for (let attempt = 1; attempt <= START_MAX_ATTEMPTS; attempt += 1) {
    const outcome = await spawnDaemonOnce(args, logPath, knownPid);
    if (outcome.kind === "started") {
      console.log(`grove daemon started at ${outcome.endpoint} (pid ${outcome.pid}).`);
      console.log("Run 'grove pair' to link a phone, or 'grove status' to check on it.");
      return { endpoint: outcome.endpoint, pid: outcome.pid, alreadyRunning: false };
    }
    if (outcome.kind === "timeout") {
      throw new Error(
        `grove daemon did not become reachable within ${START_POLL_TIMEOUT_MS / 1000}s.${tailLog(logPath)}`,
      );
    }
    // outcome.kind === "exited": transient boot crash. Retry unless out of attempts.
    if (attempt === START_MAX_ATTEMPTS) {
      throw new Error(
        `grove daemon exited early (code ${outcome.code}) on every one of ${START_MAX_ATTEMPTS} attempts.${tailLog(logPath)}`,
      );
    }
    await delay(400);
  }
  // Unreachable: the loop returns or throws on every path.
  throw new Error("grove daemon failed to start.");
}

type SpawnOutcome =
  | { readonly kind: "started"; readonly endpoint: string; readonly pid: number }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "timeout" };

/**
 * One detached spawn + reachability poll. Spawns `node <cli> host <args>` with
 * `detached: true` + `unref()` (so the daemon outlives this CLI), stdio → log file,
 * then polls until the child writes a FRESH manifest AND `/healthz` answers. Returns
 * `started` on success, `exited` if the child dies first (caller may retry), or
 * `timeout` if neither happens within the bound.
 */
async function spawnDaemonOnce(
  args: readonly string[],
  logPath: string,
  knownPid: number | undefined,
): Promise<SpawnOutcome> {
  const logFd = openSync(logPath, "a");
  const child = spawn(nodeBin(), [SELF_PATH, "host", ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  closeSync(logFd); // the child holds its own dup; release the parent's copy.

  let childExit: number | null | undefined;
  child.once("exit", (code) => {
    childExit = code;
  });

  const deadline = Date.now() + START_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (childExit !== undefined) {
      return { kind: "exited", code: childExit };
    }
    const manifest = readManifest();
    if (
      manifest &&
      manifest.pid !== knownPid &&
      pidAlive(manifest.pid) &&
      (await healthzOk(manifest.endpoint))
    ) {
      return { kind: "started", endpoint: manifest.endpoint, pid: manifest.pid };
    }
    await delay(250);
  }
  return { kind: "timeout" };
}

/** Tail the daemon log for an error message — the daemon's own crash reason. */
function tailLog(logPath: string): string {
  try {
    const text = readFileSync(logPath, "utf8").trimEnd();
    if (!text) {
      return ` See ${logPath}`;
    }
    const tail = text.length > 2000 ? `…${text.slice(-2000)}` : text;
    return ` See ${logPath}:\n${tail}`;
  } catch {
    return ` See ${logPath}`;
  }
}

export interface StopResult {
  readonly stopped: boolean;
  readonly pid: number | null;
  readonly wasRunning: boolean;
}

/**
 * `grove stop` — read the manifest PID and terminate the daemon's whole process
 * tree: a graceful pass first (SIGTERM to the process group on POSIX / `taskkill /T`
 * on Windows), then a forced pass (SIGKILL / `taskkill /T /F`) if it survives the
 * grace window (ADR-0011). Confirms the PID is gone, then clears the manifest so
 * `status` reads stopped. Honest when nothing is running.
 */
export async function runStop(): Promise<StopResult> {
  const manifest = readManifest();
  if (!manifest) {
    console.log("grove daemon: not running (no manifest).");
    return { stopped: true, pid: null, wasRunning: false };
  }
  if (!pidAlive(manifest.pid)) {
    rmSync(defaultManifestPath(), { force: true });
    console.log(`grove daemon: not running (stale manifest for pid ${manifest.pid} cleared).`);
    return { stopped: true, pid: manifest.pid, wasRunning: false };
  }

  // Graceful, then forced if it survives.
  treeKill(manifest.pid, "SIGTERM");
  await waitForDeath(manifest.pid, STOP_GRACE_MS);
  if (pidAlive(manifest.pid)) {
    treeKill(manifest.pid, "SIGKILL");
    await waitForDeath(manifest.pid, STOP_GRACE_MS);
  }

  const stopped = !pidAlive(manifest.pid);
  if (stopped) {
    // A force-kill never runs the daemon's own cleanup, so clear the manifest here.
    rmSync(defaultManifestPath(), { force: true });
    console.log(`grove daemon stopped (pid ${manifest.pid}).`);
  } else {
    console.log(`grove daemon: FAILED to stop pid ${manifest.pid} — still alive after force-kill.`);
  }
  return { stopped, pid: manifest.pid, wasRunning: true };
}

/** Poll until `pid` is dead or `timeoutMs` elapses (bounded; never hangs). */
async function waitForDeath(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pidAlive(pid)) {
    await delay(150);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Phase-5 W2 — `grove up`: the one-command bootstrap (ADR-0015). Composes a
// cross-platform dependency preflight → idempotent `start` (boots the daemon, on
// which the host creates the PGlite store + bearer + VAPID keypair) → mint + render
// the pairing QR. Idempotent, honest, and never throws an unhandled error.
// ──────────────────────────────────────────────────────────────────────────

export interface UpResult {
  /** True when the bootstrap reached its goal (or, for `--check`, the preflight passed). */
  readonly ok: boolean;
  readonly depReport: DepReport;
  /** The started/attached daemon, or `null` when preflight-only or it failed. */
  readonly started: StartResult | null;
  /** The minted single-use pair code + URL, or `null` when not reached. */
  readonly paired: { code: string; endpoint: string; url: string } | null;
  /** `--check`/`--dry-run`: ran the preflight only, started nothing. */
  readonly dryRun: boolean;
  /** Process exit code the dispatcher should adopt (0 ok, non-zero on failure). */
  readonly exitCode: number;
}

/**
 * `grove up [--check] [--port N] [--db DIR] [--host H | --lan]` — stand up a private
 * Grove in one command. (1) Verify deps cross-platform (node/bun/git required,
 * cloudflared optional — ADR-0004, no shell assumptions); abort with exact install
 * hints if a required tool is missing. (2) `--check` stops here (preflight only).
 * (3) Otherwise start the daemon idempotently (`runStart` — boots the host, which
 * creates/loads the store + bearer + VAPID), passing `--port`/`--db`/`--host`/`--lan`
 * through. (4) Mint a single-use code + render the scannable QR (`runPair`). Catches
 * every error into a friendly message + non-zero exit — never a stack trace.
 */
export async function runUp(args: readonly string[] = []): Promise<UpResult> {
  const dryRun = args.includes("--check") || args.includes("--dry-run");
  const lan = args.includes("--lan");
  // Forward host/start flags through to the daemon; strip the up-only flags.
  const forwarded = args.filter((arg) => arg !== "--check" && arg !== "--dry-run");

  console.log("grove up — bootstrapping your private Grove…\n");

  // 1) Dependency preflight (cross-platform; ADR-0004 — no shell, no where/which).
  const depReport = await verifyDeps();
  console.log("Prerequisites:");
  console.log(formatDepTable(depReport));
  const cloudflared = depReport.checks.find((check) => check.spec.bin === "cloudflared");
  if (cloudflared && !cloudflared.found) {
    console.log("  note: cloudflared is optional — only 'grove up --remote' (W3) needs it.");
  }
  console.log("");

  if (!depReport.ok) {
    console.log("Missing required tools — cannot continue:");
    for (const check of depReport.missingRequired) {
      console.log(`  • ${check.spec.label}: ${check.spec.installHint}`);
    }
    console.log("\nInstall the above, then re-run 'grove up'.");
    return { ok: false, depReport, started: null, paired: null, dryRun, exitCode: 1 };
  }

  if (dryRun) {
    console.log("Preflight only (--check): all required tools present. Not starting the daemon.");
    return { ok: true, depReport, started: null, paired: null, dryRun: true, exitCode: 0 };
  }

  try {
    // 2) Bring the daemon up (idempotent — attaches + reports if already running).
    const started = await runStart(forwarded);

    // 3) Mint a single-use pairing code + render the scannable terminal QR.
    console.log("");
    const paired = await runPair(lan ? ["--lan"] : []);

    // 4) Tidy bootstrap summary.
    console.log("");
    console.log("Grove is up.");
    console.log(`  endpoint:  ${started.endpoint}`);
    console.log(`  pid:       ${started.pid}`);
    console.log("  scan the QR above with your phone's camera to pair.");
    console.log("  run 'grove stop' to shut it down.");
    return { ok: true, depReport, started, paired, dryRun: false, exitCode: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`\ngrove up failed: ${message}`);
    console.log("Run 'grove status' to see what is running, or 'grove stop' to shut it down.");
    return { ok: false, depReport, started: null, paired: null, dryRun: false, exitCode: 1 };
  }
}

/**
 * Wire graceful shutdown for the foreground daemon (`grove host` and the detached
 * child `grove start` spawns): on SIGTERM/SIGINT close the host — which releases the
 * sockets, tree-kills its PTYs and removes the manifest — then exit. This makes
 * `grove stop`'s graceful pass actually clean up on POSIX; on Windows it falls
 * through to the forced `taskkill /T /F` (no deliverable graceful signal there).
 */
function installDaemonShutdown(host: RunningHost): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    host
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/** `grove help` / `grove --help` text (documents `up` as the friendly path). */
const USAGE = `grove — mission control for a swarm of coding agents

Usage: grove <command> [options]

Commands:
  up        Bootstrap everything: check deps → start the daemon → print a pair QR
  start     Start the host daemon in the background (detached, under Node)
  stop      Stop the running host daemon (graceful, then tree-kill)
  status    Report whether the host daemon is running
  host      Run the host daemon in the FOREGROUND (debugging)
  pair      Mint a single-use code + QR to link a phone to a running host

Options (up / start / host):
  --port <n>     Bind TCP port (0 = OS-assigned, the default)
  --db <dir>     PGlite data directory
  --host <addr>  Bind address (default 127.0.0.1)
  --lan          Bind 0.0.0.0 and show the LAN URL (phone on the same network)

Options (up):
  --check        Run the dependency preflight only; start nothing

Run 'grove up' for the friendly one-command path.`;

/** Dispatch one CLI invocation. Sets `process.exitCode` instead of throwing for `up`. */
async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  let invocation: ParsedInvocation;
  try {
    invocation = parseArgv(argv);
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    console.log(`\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const { command, args } = invocation;
  if (command === "up") {
    const result = await runUp(args);
    process.exitCode = result.exitCode;
  } else if (command === "start") {
    await runStart(args);
  } else if (command === "stop") {
    await runStop();
  } else if (command === "host") {
    const host = await runHost(args);
    installDaemonShutdown(host);
  } else if (command === "pair") {
    await runPair(args);
  } else if (command === "status") {
    await runStatus();
  } else {
    console.log(`grove: '${command}' is not wired yet.`);
    console.log(`\n${USAGE}`);
  }
}

// Run the dispatcher only when executed directly (never on import). The cast
// keeps this typecheck-clean without depending on a runtime-specific ImportMeta
// augmentation; the field is set by Bun and Node when a module is the entrypoint.
if ((import.meta as { main?: boolean }).main === true) {
  await main(process.argv.slice(2));
}
