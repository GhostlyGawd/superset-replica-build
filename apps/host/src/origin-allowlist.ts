/**
 * Optional Origin/Host allowlist — defense-in-depth for the remote path (Phase-5 W3,
 * ADR-0017). The bearer token is the REAL gate (P11): a request without it is 401'd
 * regardless of where it came from, so by default the host stays permissive and
 * reflects any Origin (the Phase-4 behavior, which keeps same-origin / LAN / loopback
 * and the random per-session tunnel host all working). When an operator sets
 * `GROVE_ALLOWED_ORIGINS` (comma-separated origins or bare hosts), CORS reflection is
 * narrowed to those entries — loopback and RFC-1918 LAN are ALWAYS permitted so
 * `--lan` pairing and local clients never break. This is the extra layer that lets a
 * security-conscious operator pin the exact tunnel origin once they know it.
 */

/** Parse `GROVE_ALLOWED_ORIGINS` into a set of allowed hosts, or `null` (permissive). */
export function parseAllowedOrigins(raw: string | undefined): Set<string> | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null; // unset/empty ⇒ permissive default (bearer is the gate).
  }
  const hosts = new Set<string>();
  for (const entry of trimmed.split(",")) {
    const value = entry.trim();
    if (!value) {
      continue;
    }
    try {
      hosts.add(new URL(value).host.toLowerCase());
    } catch {
      hosts.add(value.toLowerCase()); // accept a bare `host[:port]` too.
    }
  }
  return hosts.size > 0 ? hosts : null;
}

/** Loopback or RFC-1918 private host — always allowed so local/LAN never breaks. */
export function isLocalHost(host: string): boolean {
  const name =
    host
      .toLowerCase()
      .replace(/^\[/, "")
      .replace(/](?::\d+)?$/, "")
      .split(":")[0] ?? "";
  if (name === "localhost" || name === "127.0.0.1" || name === "::1") {
    return true;
  }
  return (
    /^10\./.test(name) ||
    /^192\.168\./.test(name) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(name) ||
    /^127\./.test(name)
  );
}

/**
 * Decide whether a CORS `Origin` is permitted. With no allowlist configured, every
 * origin is reflected (default). With one configured, only loopback/LAN origins and
 * exact allowlist entries are reflected; anything else is denied at the CORS layer
 * (the bearer still gates the actual data either way).
 */
export function isOriginAllowed(origin: string, allowlist: Set<string> | null): boolean {
  if (!allowlist) {
    return true;
  }
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return isLocalHost(host) || allowlist.has(host);
}
