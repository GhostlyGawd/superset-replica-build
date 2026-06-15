import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createHost } from "@swarm/host";
import { type RunningHost, defaultManifestPath, runDaemon } from "@swarm/host/daemon";
import qrcode from "qrcode-terminal";

/**
 * @swarm/cli — the `grove` command-line entrypoint (spec §2, P13). Verb parsing
 * is real from Phase 0; `grove host` starts the real headless daemon (Phase 2),
 * `grove pair` bootstraps the mobile PWA (Phase 4, ADR-0014); remote/daemon-detach
 * behavior attaches in Phase 5.
 */

export const CLI_VERSION = "0.1.0";

export const CLI_COMMANDS = [
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

/** Render the line the `grove status` verb prints. */
export function statusLine(): string {
  const status = createHost().status();
  return `grove ${status.version} bound ${status.boundTo} online=${status.online}`;
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
 */
export async function runPair(args: readonly string[] = []): Promise<void> {
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
}

// Run the dispatcher only when executed directly (never on import). The cast
// keeps this typecheck-clean without depending on a runtime-specific ImportMeta
// augmentation; the field is set by Bun and Node when a module is the entrypoint.
if ((import.meta as { main?: boolean }).main === true) {
  const { command, args } = parseArgv(process.argv.slice(2));
  if (command === "host") {
    await runHost(args);
  } else if (command === "pair") {
    await runPair(args);
  } else if (command === "status") {
    console.log(statusLine());
  } else {
    console.log(`grove: '${command}' is not wired yet (Phase 2 ships 'host' + 'status').`);
  }
}
