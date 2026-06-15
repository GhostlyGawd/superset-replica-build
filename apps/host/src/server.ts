import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { openStore } from "@swarm/db/store";
import type { Store } from "@swarm/db/store";
import { PtySupervisor } from "@swarm/pty-supervisor";
import { APP_CODENAME, asId } from "@swarm/shared";
import type { HostId } from "@swarm/shared";
import { EventLog } from "@swarm/sync";
import { type SyncServer, createSyncServer } from "@swarm/sync/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Orchestrator } from "./orchestrator.ts";
import { PairingStore } from "./pair.ts";
import { PgliteEventLogStore } from "./pglite-event-log-store.ts";
import { type TerminalServer, createTerminalServer } from "./terminal-server.ts";
import { type HostServices, createAppRouter, osName } from "./trpc.ts";
import { HOST_VERSION } from "./version.ts";

const DEFAULT_BIND_HOST = "127.0.0.1";
const SYNC_PATH = "/sync";
const TERMINAL_PATH = "/terminal";

/** The PWA's public bootstrap — exchanged for the bearer, so it cannot require one. */
const PUBLIC_PAIR_REDEEM_PATH = "/trpc/pair.redeem";

/**
 * The built mobile PWA's `dist/`, resolved relative to this module so it is found
 * whether the host runs from source (`apps/host/src`) or its build (`apps/host/dist`)
 * — both sit one level under `apps/host`, so `../../mobile/dist` lands on the PWA.
 */
function defaultPwaDir(): string {
  return fileURLToPath(new URL("../../mobile/dist", import.meta.url));
}

/** On-disk handshake a local client reads to find + authenticate the host. */
export interface HostManifest {
  /** Loopback HTTP base, e.g. `http://127.0.0.1:8787`. */
  readonly endpoint: string;
  /** Bearer token every API/WS call must present. */
  readonly token: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface StartHostOptions {
  readonly store: Store;
  readonly eventLog: EventLog;
  /** Reuse an existing orchestrator (so programmatic + tRPC share one). */
  readonly orchestrator?: Orchestrator;
  /** Required when `orchestrator` is omitted — the host builds one over this. */
  readonly supervisor?: PtySupervisor;
  readonly hostId?: HostId;
  /** Bind address; loopback by default for privacy (P11). */
  readonly host?: string;
  /** TCP port; 0 (default) binds an OS-assigned ephemeral port. */
  readonly port?: number;
  /** Bearer token; a 256-bit random one is generated when omitted. */
  readonly token?: string;
  /** Directory for `manifest.json`; defaults to `<homedir>/.grove/host`. */
  readonly manifestDir?: string;
  readonly deviceName?: string;
  readonly owner?: string;
  /** Base dir for worktrees created via the API; defaults to `~/.grove/worktrees`. */
  readonly worktreesRoot?: string;
  /** Sync heartbeat interval (ms); 0 disables. Default 15000. */
  readonly heartbeatMs?: number;
  /**
   * Directory of the built mobile PWA to serve same-origin at `/` (ADR-0014).
   * Defaults to `apps/mobile/dist`; static serving is skipped when it is absent.
   */
  readonly pwaDir?: string;
}

export interface RunningHost {
  readonly hostId: HostId;
  readonly endpoint: string;
  readonly wsUrl: string;
  readonly port: number;
  readonly token: string;
  readonly manifestPath: string;
  readonly manifest: HostManifest;
  readonly orchestrator: Orchestrator;
  close(): Promise<void>;
}

/** The canonical manifest location a client looks for (cross-platform). */
export function defaultManifestPath(): string {
  return join(homedir(), ".grove", "host", "manifest.json");
}

/** Constant-time-ish bearer check over a header or `?token=` query (WS upgrades). */
function authorizeRequest(req: IncomingMessage, token: string): boolean {
  if (req.headers.authorization === `Bearer ${token}`) {
    return true;
  }
  try {
    return new URL(req.url ?? "", "http://localhost").searchParams.get("token") === token;
  } catch {
    return false;
  }
}

/**
 * Start the headless host engine: a Hono HTTP server exposing the tRPC surface
 * under `/trpc`, with the WebSocket sync hub mounted on the SAME loopback port at
 * `/sync` (architecture §1). Both require a bearer token (P11); the token +
 * endpoint are written to a manifest so a local client can discover and
 * authenticate. Runs under Node (the orchestrator drives node-pty, ADR-0007a).
 */
export async function startHost(options: StartHostOptions): Promise<RunningHost> {
  const { store, eventLog } = options;
  const bindHost = options.host ?? DEFAULT_BIND_HOST;
  const token = options.token ?? randomBytes(32).toString("base64url");
  const hostId =
    options.hostId ??
    asId<"HostId">(`${APP_CODENAME.toLowerCase()}-${randomBytes(6).toString("hex")}`);

  const orchestrator =
    options.orchestrator ??
    (() => {
      if (!options.supervisor) {
        throw new Error("startHost requires either `orchestrator` or `supervisor`");
      }
      return new Orchestrator({
        store,
        eventLog,
        supervisor: options.supervisor,
        worktreesRoot: options.worktreesRoot,
      });
    })();

  let boundPort = options.port ?? 0;
  const endpoint = (): string => `http://${bindHost}:${boundPort}`;
  const pairing = new PairingStore();

  const services: HostServices = {
    store,
    eventLog,
    orchestrator,
    hostId,
    version: HOST_VERSION,
    os: osName(),
    deviceName: options.deviceName ?? "grove-host",
    owner: options.owner ?? "",
    endpoint,
    token,
    pairing,
  };

  const appRouter = createAppRouter();
  const app = new Hono();

  // Unauthenticated liveness probe (carries no state). Relocated off `/` so the
  // host can serve the PWA's index there (ADR-0014); callers/tests use `/healthz`.
  app.get("/healthz", (c) => c.json({ ok: true, name: APP_CODENAME, hostId, online: true }));

  // Browser-based clients (the desktop renderer's dev server / file origin, the
  // mobile PWA) reach the host cross-origin, so the tRPC surface answers CORS
  // preflight and reflects the allowed methods/headers. This is safe because the
  // bearer token — not the origin — is the actual gate (P11): a permitted origin
  // still cannot call anything without the token. Mounted BEFORE the auth guard so
  // the credential-less OPTIONS preflight is short-circuited here, not 401'd.
  app.use(
    "/trpc/*",
    cors({
      origin: (origin) => origin ?? "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 86_400,
    }),
  );

  // Everything under /trpc requires the bearer token (P11) — EXCEPT the public
  // pairing bootstrap. `pair.redeem` exchanges a single-use code for the bearer, so
  // it cannot itself demand one; it is whitelisted here, ahead of the guard, exactly
  // like the CORS preflight above (ADR-0014). A batched call would change the path
  // (e.g. `/trpc/pair.redeem,workspaces.list`) and so still hit the guard — the PWA
  // calls redeem standalone, with its own bearer-less client.
  app.use("/trpc/*", async (c, next) => {
    if (c.req.path === PUBLIC_PAIR_REDEEM_PATH) {
      return next();
    }
    if (c.req.header("Authorization") !== `Bearer ${token}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });
  app.use("/trpc/*", trpcServer({ router: appRouter, createContext: () => ({ services }) }));

  // Serve the built PWA same-origin (ADR-0014 decision 1): the host IS the app
  // origin, so there is no CORS/origin ambiguity and `localhost` is a secure context.
  // Static assets need NO bearer to LOAD — only `/trpc` does. The `/sync` + `/terminal`
  // WebSocket upgrades ride the raw server (below), so they are untouched by this.
  // Unknown navigations fall back to `index.html` (single-page app).
  const pwaDir = options.pwaDir ?? defaultPwaDir();
  if (existsSync(pwaDir)) {
    app.use("/*", serveStatic({ root: pwaDir }));
    app.get("*", serveStatic({ root: pwaDir, path: "index.html" }));
  }

  // Bind, then learn the ephemeral port.
  const server = await new Promise<Server>((resolve) => {
    const srv = serve({ fetch: app.fetch, hostname: bindHost, port: options.port ?? 0 }, (info) => {
      boundPort = info.port;
      resolve(srv as unknown as Server);
    });
  });

  // Mount the WS sync hub on the host-owned server, gated by the same token.
  const sync: SyncServer = await createSyncServer({
    log: eventLog,
    hostId,
    host: bindHost,
    path: SYNC_PATH,
    heartbeatMs: options.heartbeatMs ?? 15_000,
    server,
    authorize: (req) => authorizeRequest(req, token),
  });

  // Mount the ephemeral terminal-IO hub on the SAME server + token (architecture
  // §4): high-frequency PTY bytes ride this topic, out-of-band from the durable
  // sync log above. Registered after the sync hub so both upgrade listeners
  // coexist (each ignores the other's path). Shares the orchestrator's supervisor
  // so host shutdown's killAll() is a backstop for any terminal PTY.
  const terminal: TerminalServer = await createTerminalServer({
    server,
    supervisor: options.supervisor ?? orchestrator.ptySupervisor,
    path: TERMINAL_PATH,
    authorize: (req) => authorizeRequest(req, token),
    cwdFor: async (workspaceId) => {
      const ws = await store.getWorkspace(asId<"WorkspaceId">(workspaceId));
      return ws?.worktreePath;
    },
  });

  const resolvedEndpoint = endpoint();
  const manifestDir = options.manifestDir ?? join(homedir(), ".grove", "host");
  mkdirSync(manifestDir, { recursive: true });
  const manifestPath = join(manifestDir, "manifest.json");
  const manifest: HostManifest = {
    endpoint: resolvedEndpoint,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    hostId,
    endpoint: resolvedEndpoint,
    wsUrl: sync.url,
    port: boundPort,
    token,
    manifestPath,
    manifest,
    orchestrator,
    close: async () => {
      // Deterministic teardown — the order matters on Windows, where a lingering
      // socket or PTY pipe otherwise keeps the process alive past test timeout:
      //   1) release the WS sync + terminal hubs (terminates live sockets, detaches
      //      the handlers, and tree-kills terminal PTYs);
      //   2) tree-kill every spawned PTY/agent process so no node-pty pipe survives;
      //   3) force-close lingering keep-alive HTTP/WS sockets (undici's fetch pool
      //      keeps these OPEN — plain `server.close()` then waits forever for them),
      //      THEN stop accepting and close the listener.
      await sync.close();
      await terminal.close();
      await orchestrator.shutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        rmSync(manifestPath, { force: true });
      } catch {
        // Manifest may already be gone; cleanup is best-effort.
      }
    },
  };
}

export interface RunDaemonOptions {
  /** PGlite/Postgres connection string (ADR-0003); defaults to embedded PGlite. */
  readonly databaseUrl?: string;
  /** Explicit PGlite data directory; wins over `databaseUrl`. */
  readonly dataDir?: string;
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly manifestDir?: string;
  readonly worktreesRoot?: string;
  readonly heartbeatMs?: number;
  /** Override the served PWA directory; defaults to the built `apps/mobile/dist`. */
  readonly pwaDir?: string;
}

/**
 * Compose the full daemon from nothing: open the PGlite store, wire the
 * PGlite-backed event log, a PTY supervisor + orchestrator, then start the host.
 * This is what `grove host` runs. `close()` also closes the store.
 */
export async function runDaemon(options: RunDaemonOptions = {}): Promise<RunningHost> {
  const store = await openStore({ databaseUrl: options.databaseUrl, dataDir: options.dataDir });
  const hostId = asId<"HostId">(`${APP_CODENAME.toLowerCase()}-${randomBytes(6).toString("hex")}`);
  const eventLog = new EventLog(new PgliteEventLogStore(store, hostId));
  const supervisor = new PtySupervisor();

  const running = await startHost({
    store,
    eventLog,
    supervisor,
    hostId,
    host: options.host,
    port: options.port,
    token: options.token,
    manifestDir: options.manifestDir,
    worktreesRoot: options.worktreesRoot,
    heartbeatMs: options.heartbeatMs,
    pwaDir: options.pwaDir,
  });

  const baseClose = running.close;
  return {
    ...running,
    close: async () => {
      await baseClose();
      await store.close();
    },
  };
}
