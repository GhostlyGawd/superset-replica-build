import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A local Caddy reverse-proxy that terminates self-signed HTTPS (`tls internal`) in
 * front of the loopback Grove host (ADR-0017). Its only Phase-5 role is to give the
 * secure-context proof a REAL `https://localhost:<port>` origin without any paid cert
 * or public tunnel — the phone path uses cloudflared's trusted edge cert; this is
 * never shipped to a device. It proves that over an HTTPS origin the PWA's service
 * worker registers and `pushManager.subscribe` resolves (closing ADR-0014 dec-4).
 */
export interface CaddyTlsProxy {
  /** The HTTPS origin the browser loads (`https://localhost:<port>`). */
  readonly httpsUrl: string;
  /** The Caddy CA root cert (PEM) — for reference/evidence; the browser bypasses it. */
  stop(): Promise<void>;
}

/** Resolve the `caddy` binary (a real `.exe` on Windows via scoop; `which` on POSIX). */
function resolveCaddy(): string {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(finder, ["caddy"], { encoding: "utf8", windowsHide: true });
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (first) {
      return first.trim();
    }
  } catch {
    // fall through
  }
  return "caddy"; // last resort — let spawn surface ENOENT honestly.
}

/** Grab a free loopback TCP port for the HTTPS listener. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Probe an HTTPS URL, ignoring the self-signed cert, for readiness polling. */
function probeHttps(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpsGet(url, { rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Spawn Caddy as a `tls internal` reverse-proxy in front of `upstream`
 * (e.g. `http://127.0.0.1:4319`) and wait until the HTTPS origin answers. `tls
 * internal` mints a self-signed cert from Caddy's local CA; `skip_install_trust`
 * keeps Caddy from touching the system trust store (the browser bypasses the cert via
 * `--ignore-certificate-errors`). All state lives in a throwaway temp dir.
 */
export async function startCaddyTlsProxy(upstream: string): Promise<CaddyTlsProxy> {
  const port = await freePort();
  const httpsUrl = `https://localhost:${port}`;
  const dir = mkdtempSync(join(tmpdir(), "grove-caddy-sc-"));
  const dataDir = join(dir, "data").replace(/\\/g, "/");
  const upstreamHostPort = new URL(upstream).host; // 127.0.0.1:4319

  writeFileSync(
    join(dir, "Caddyfile"),
    [
      "{",
      "\tadmin off",
      "\tauto_https disable_redirects",
      "\tskip_install_trust",
      `\tstorage file_system "${dataDir}"`,
      "}",
      "",
      `https://localhost:${port} {`,
      "\ttls internal",
      `\treverse_proxy ${upstreamHostPort}`,
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  const child: ChildProcess = spawn(
    resolveCaddy(),
    ["run", "--config", join(dir, "Caddyfile"), "--adapter", "caddyfile"],
    { stdio: "ignore", windowsHide: true },
  );

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && !child.killed) {
    if (await probeHttps(`${httpsUrl}/healthz`)) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Caddy TLS proxy never became ready at ${httpsUrl}`);
  }

  return {
    httpsUrl,
    async stop() {
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup
      }
    },
  };
}
