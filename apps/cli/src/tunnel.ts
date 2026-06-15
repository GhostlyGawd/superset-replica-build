import { type ChildProcess, spawn } from "node:child_process";
import { treeKill } from "./proc.ts";

/**
 * @swarm/cli — the remote-path tunnel manager (Phase-5 W3, ADR-0017). A quick
 * tunnel gives the loopback host a PUBLIC, HTTPS origin so a phone can reach it from
 * anywhere — and, because an HTTPS origin is a secure context, it is where on-device
 * Service-Worker install + Web Push finally light up (closing the ADR-0014 dec-4
 * deferral). The host itself never leaves `127.0.0.1`; the tunnel terminates TLS at
 * the provider edge and proxies to loopback.
 *
 * Default provider = **cloudflared** quick tunnel (`cloudflared tunnel --url
 * http://127.0.0.1:<port>`, Apache-2.0 binary, publicly-trusted edge cert, no
 * account). Fallback = **localtunnel** (MIT, `lt --port <port>`), auto-selected when
 * cloudflared is absent. Both are REAL binaries on the user path — there is no mock;
 * the only seam is an explicit `command` override the unit test points at a committed
 * stub binary (the real binary is what runs in production).
 */

export type TunnelProvider = "cloudflared" | "localtunnel";

/** How long to wait for the provider to print its public URL before giving up. */
const DEFAULT_TUNNEL_TIMEOUT_MS = 25_000;

/**
 * A public-URL matcher covering both providers: cloudflared prints
 * `https://<random>.trycloudflare.com` (inside an ASCII banner, so it is bounded by
 * spaces/box borders) and localtunnel prints `your url is: https://<random>.loca.lt`.
 * The character class stops at the first space/quote/border so only the URL is
 * captured, regardless of surrounding decoration.
 */
const TUNNEL_URL_RE = /https:\/\/[a-z0-9][a-z0-9.-]*\.(?:trycloudflare\.com|loca\.lt)/i;

/** An explicit binary to run instead of resolving a provider (the unit-test seam). */
export interface TunnelCommandOverride {
  readonly bin: string;
  readonly args: readonly string[];
  /** Extra env merged over the inherited environment (drives the committed stub). */
  readonly env?: Record<string, string>;
}

export interface StartTunnelOptions {
  /** Loopback port the host daemon is bound to (the tunnel proxies to it). */
  readonly port: number;
  /** Preferred provider; omitted ⇒ cloudflared with localtunnel auto-fallback. */
  readonly provider?: TunnelProvider;
  /** Bounded wait for the public URL to appear (ms). */
  readonly timeoutMs?: number;
  /**
   * TEST SEAM ONLY (ADR-0017): run this exact command instead of a real provider.
   * The unit test injects a committed stub binary here; the real cloudflared /
   * localtunnel binary is what runs on every user path (this is never set there).
   */
  readonly command?: TunnelCommandOverride;
}

export interface Tunnel {
  /** The public HTTPS origin (no trailing slash), e.g. `https://x.trycloudflare.com`. */
  readonly url: string;
  /** Which provider produced the tunnel (or the injected command's provider). */
  readonly provider: TunnelProvider;
  /** PID of the live tunnel process (for diagnostics / liveness assertions). */
  readonly pid: number | undefined;
  /** Tree-kill the tunnel process, tearing the tunnel down. Idempotent. */
  stop(): void;
}

/** Internal spawn spec: a command plus the Windows `.cmd`-shim shell hint. */
interface SpawnSpec {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  /** Resolve a `.cmd`/`.ps1` shim via the shell (Windows npm-global bins). */
  readonly shell?: boolean;
}

type SpawnResult =
  | { readonly kind: "url"; readonly child: ChildProcess; readonly url: string }
  | { readonly kind: "enoent" }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "timeout"; readonly child: ChildProcess }
  | { readonly kind: "spawn-error"; readonly message: string };

/** Drop any trailing slash so `${url}/?code=` never doubles it. */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Map a provider to its real binary + args (cloudflared is the default). */
function resolveProviderCommand(provider: TunnelProvider, port: number): SpawnSpec {
  if (provider === "cloudflared") {
    return { bin: "cloudflared", args: ["tunnel", "--url", `http://127.0.0.1:${port}`] };
  }
  // localtunnel's CLI binary is `lt`; on Windows a global npm install lands a
  // `lt.cmd` shim that bare CreateProcess cannot resolve, so route it through the
  // shell there (the args are a fixed integer port — no injection surface).
  return { bin: "lt", args: ["--port", String(port)], shell: process.platform === "win32" };
}

/**
 * Spawn one candidate and resolve as soon as a public URL appears in its output (or
 * it errors / exits / times out). Never throws — the caller decides whether to
 * fall back to the next provider or surface an honest error. cloudflared prints the
 * URL to stderr and localtunnel to stdout, so both streams are scanned; chunks are
 * accumulated because the URL line can straddle a chunk boundary.
 */
function spawnAndAwaitUrl(spec: SpawnSpec, timeoutMs: number): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(spec.bin, [...spec.args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: spec.shell ?? false,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
      });
    } catch (err) {
      resolve({ kind: "spawn-error", message: (err as Error).message });
      return;
    }

    let settled = false;
    let buffer = "";

    const finish = (result: SpawnResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      resolve(result);
    };

    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(TUNNEL_URL_RE);
      if (match) {
        finish({ kind: "url", child, url: normalizeUrl(match[0]) });
      }
    };
    const onError = (err: NodeJS.ErrnoException): void => {
      finish(
        err.code === "ENOENT" ? { kind: "enoent" } : { kind: "spawn-error", message: err.message },
      );
    };
    const onExit = (code: number | null): void => {
      finish({ kind: "exited", code });
    };
    const timer = setTimeout(() => finish({ kind: "timeout", child }), timeoutMs);

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

/** Wrap a live child process as a `Tunnel` whose `stop()` tree-kills it. */
function makeTunnel(child: ChildProcess, url: string, provider: TunnelProvider): Tunnel {
  return {
    url: normalizeUrl(url),
    provider,
    pid: child.pid,
    stop(): void {
      if (child.pid !== undefined) {
        treeKill(child.pid, "SIGKILL");
      }
    },
  };
}

/** Turn a non-URL spawn result into an honest error, killing a stuck child first. */
function failure(
  result: Exclude<SpawnResult, { kind: "url" }>,
  label: string,
  timeoutMs: number,
): Error {
  if (result.kind === "timeout" && result.child.pid !== undefined) {
    treeKill(result.child.pid, "SIGKILL");
  }
  switch (result.kind) {
    case "timeout": {
      const seconds = Math.round(timeoutMs / 1000);
      return new Error(
        `${label} did not print a public URL within ${seconds}s. Check your network and that the provider is reachable.`,
      );
    }
    case "exited":
      return new Error(
        `${label} exited (code ${result.code ?? "null"}) before a public URL appeared.`,
      );
    case "enoent":
      return new Error(`${label} is not installed or not on PATH.`);
    default:
      return new Error(`${label} failed to start: ${result.message}`);
  }
}

/** The install-docs error shown when no tunnel provider is available at all. */
function noProviderError(tried: readonly TunnelProvider[]): Error {
  const names = tried.length > 0 ? tried.join(" or ") : "cloudflared or localtunnel";
  const docs =
    "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
  const lines = [
    `No tunnel provider found (${names}). The remote path needs a quick-tunnel binary.`,
    `  • cloudflared (default): ${docs}`,
    "  • localtunnel (OSS fallback): npm i -g localtunnel (provides the lt command)",
    "Install one, then re-run with --remote.",
  ];
  return new Error(lines.join("\n"));
}

/**
 * Start a tunnel and resolve with its public HTTPS URL + a `stop()` that tree-kills
 * it. cloudflared is tried first, then localtunnel, UNLESS a provider is pinned. A
 * missing binary (ENOENT) auto-falls-through to the next provider; a provider that
 * IS present but fails (timeout / early exit) surfaces an honest error rather than
 * silently switching. When the `command` seam is set, that exact binary is run
 * instead (the unit test's committed stub) — the real binary runs everywhere else.
 */
export async function startTunnel(options: StartTunnelOptions): Promise<Tunnel> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TUNNEL_TIMEOUT_MS;

  if (options.command) {
    const spec: SpawnSpec = {
      bin: options.command.bin,
      args: options.command.args,
      env: options.command.env,
    };
    const result = await spawnAndAwaitUrl(spec, timeoutMs);
    if (result.kind === "url") {
      return makeTunnel(result.child, result.url, options.provider ?? "cloudflared");
    }
    throw failure(result, `tunnel command \`${options.command.bin}\``, timeoutMs);
  }

  const order: TunnelProvider[] = options.provider
    ? [options.provider]
    : ["cloudflared", "localtunnel"];
  const absent: TunnelProvider[] = [];

  for (const provider of order) {
    const result = await spawnAndAwaitUrl(
      resolveProviderCommand(provider, options.port),
      timeoutMs,
    );
    if (result.kind === "url") {
      return makeTunnel(result.child, result.url, provider);
    }
    if (result.kind === "enoent") {
      absent.push(provider);
      continue; // auto-fallback: the binary simply is not installed.
    }
    // Present but broken — be honest, do not silently switch providers.
    throw failure(result, provider, timeoutMs);
  }

  throw noProviderError(absent);
}
