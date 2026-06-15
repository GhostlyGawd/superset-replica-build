import { existsSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { homedir } from "node:os";
import type { Duplex } from "node:stream";
import { SHELL_KINDS, type ShellKind } from "@swarm/pty-supervisor";
import type { PtySupervisor } from "@swarm/pty-supervisor";
import { asId } from "@swarm/shared";
import type { PtyId } from "@swarm/shared";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

/**
 * @swarm/host terminal-IO hub — the ephemeral WebSocket topic that carries a real
 * PTY's bytes both ways (spec §4, P05). It is deliberately SEPARATE from the
 * durable sync log: terminal output is high-frequency and disposable, so it never
 * touches the event store. The hub attaches to the host's existing loopback HTTP
 * server in `noServer` mode (same pattern as the sync hub) and is gated by the
 * same bearer token (P11). Each connection spawns one PTY via the shared
 * {@link PtySupervisor} and pipes `data`/`resize` in, `data`/`exit` out.
 */

const DEFAULT_PATH = "/terminal";

/** Client → host control frames over the terminal topic. */
export type TerminalClientFrame =
  | { readonly t: "data"; readonly data: string }
  | { readonly t: "resize"; readonly cols: number; readonly rows: number };

/** Host → client frames over the terminal topic. */
export type TerminalServerFrame =
  | { readonly t: "ready"; readonly ptyId: string }
  | { readonly t: "data"; readonly data: string }
  | { readonly t: "exit"; readonly exitCode: number }
  | { readonly t: "error"; readonly message: string };

export interface TerminalServerOptions {
  /** The host-owned HTTP server whose `upgrade` events the hub handles for `path`. */
  readonly server: Server;
  /** Shared supervisor; spawned terminal PTYs are tree-killed on close + host shutdown. */
  readonly supervisor: PtySupervisor;
  /** WS path; defaults to `/terminal`. */
  readonly path?: string;
  /** Gate every upgrade (bearer token), exactly like the sync hub (P11). */
  readonly authorize?: (req: IncomingMessage) => boolean;
  /** Resolve a workspace id to its on-disk worktree cwd; falsy ⇒ home dir. */
  readonly cwdFor?: (workspaceId: string) => Promise<string | undefined>;
}

export interface TerminalServer {
  readonly path: string;
  /** Live terminal connections. */
  sessionCount(): number;
  close(): Promise<void>;
}

/** The reliably-present default interactive shell for this OS. */
function platformDefaultShell(): ShellKind {
  return process.platform === "win32" ? "powershell" : "bash";
}

function parseShell(raw: string | null): ShellKind {
  return (SHELL_KINDS as readonly string[]).includes(raw ?? "")
    ? (raw as ShellKind)
    : platformDefaultShell();
}

function parseDim(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.floor(n) : fallback;
}

/**
 * Mount the terminal-IO hub on the host's server. On connect it reads the query
 * (`workspaceId`, `shell`, `cols`, `rows`, optional `cmd`), resolves the worktree
 * cwd, spawns a PTY (interactive shell, or a one-shot `cmd` run), and streams it.
 */
export async function createTerminalServer(opts: TerminalServerOptions): Promise<TerminalServer> {
  const path = opts.path ?? DEFAULT_PATH;
  const { server, supervisor } = opts;
  const wss = new WebSocketServer({ noServer: true });
  /** ptyId per live socket so close()/disconnect tree-kills the exact processes. */
  const ptys = new Map<WebSocket, PtyId>();

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const send = (frame: TerminalServerFrame): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(frame));
      }
    };

    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://localhost");
    } catch {
      send({ t: "error", message: "bad request url" });
      socket.close();
      return;
    }

    const params = url.searchParams;
    const workspaceId = params.get("workspaceId") ?? "";
    const shell = parseShell(params.get("shell"));
    const cols = parseDim(params.get("cols"), 80);
    const rows = parseDim(params.get("rows"), 24);
    const command = params.get("cmd") ?? undefined;

    void (async () => {
      const resolved = workspaceId ? await opts.cwdFor?.(workspaceId) : undefined;
      const cwd = resolved && existsSync(resolved) ? resolved : homedir();

      let ptyId: PtyId;
      try {
        const session = supervisor.spawn({
          workspaceId: asId<"WorkspaceId">(workspaceId || "terminal"),
          shell,
          cwd,
          cols,
          rows,
          command,
        });
        ptyId = session.ptyId;
      } catch (error) {
        send({ t: "error", message: error instanceof Error ? error.message : "spawn failed" });
        socket.close();
        return;
      }
      ptys.set(socket, ptyId);

      const unsubData = supervisor.onData(ptyId, (data) => send({ t: "data", data }));
      const unsubExit = supervisor.onExit(ptyId, (exit) =>
        send({ t: "exit", exitCode: exit.exitCode }),
      );

      send({ t: "ready", ptyId });

      socket.on("message", (raw: RawData) => {
        let frame: TerminalClientFrame;
        try {
          frame = JSON.parse(String(raw)) as TerminalClientFrame;
        } catch {
          return;
        }
        if (!supervisor.has(ptyId)) {
          return;
        }
        if (frame.t === "data") {
          supervisor.write(ptyId, frame.data);
        } else if (frame.t === "resize") {
          supervisor.resize(
            ptyId,
            parseDim(String(frame.cols), cols),
            parseDim(String(frame.rows), rows),
          );
        }
      });

      const cleanup = (): void => {
        unsubData();
        unsubExit();
        ptys.delete(socket);
        void supervisor.kill(ptyId);
      };
      socket.on("close", cleanup);
      socket.on("error", () => {
        /* the close event performs cleanup */
      });
    })();
  });

  const upgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== path) {
      // Not our topic — leave it for the sync hub's listener; only destroy if we
      // are the last upgrade handler (so an unknown path never hangs the socket).
      if (server.listenerCount("upgrade") <= 1) {
        socket.destroy();
      }
      return;
    }
    if (opts.authorize && !opts.authorize(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", upgradeListener);

  return {
    path,
    sessionCount: () => wss.clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        server.off("upgrade", upgradeListener);
        // Tree-kill every spawned PTY first so no node-pty ConPTY pipe survives
        // teardown (the Windows event-loop-keepalive hazard), then drop sockets.
        const kills = [...ptys.values()].map((id) => supervisor.kill(id));
        ptys.clear();
        for (const client of wss.clients) {
          client.terminate();
        }
        void Promise.all(kills).then(() => wss.close(() => resolve()));
      }),
  };
}
