import { describe, expect, test } from "bun:test";
import { isLocalHost, isOriginAllowed, parseAllowedOrigins } from "./origin-allowlist.ts";

/**
 * Phase-5 W3 (ADR-0017) proof for the optional Origin allowlist — defense-in-depth on
 * the remote path. Default (unset) must stay permissive (the bearer is the real gate);
 * when set it narrows CORS reflection but ALWAYS keeps loopback/LAN working.
 */

describe("@swarm/host — origin allowlist (defense-in-depth, default permissive)", () => {
  test("an unset/empty allowlist is permissive — any origin is reflected", () => {
    expect(parseAllowedOrigins(undefined)).toBeNull();
    expect(parseAllowedOrigins("")).toBeNull();
    expect(parseAllowedOrigins("   ")).toBeNull();
    expect(isOriginAllowed("https://evil.example.com", null)).toBe(true);
    expect(isOriginAllowed("https://anything.trycloudflare.com", null)).toBe(true);
  });

  test("a configured allowlist admits listed origins (and bare hosts) only", () => {
    const list = parseAllowedOrigins("https://abc.trycloudflare.com, x.loca.lt");
    expect(list).not.toBeNull();
    expect(isOriginAllowed("https://abc.trycloudflare.com", list)).toBe(true);
    expect(isOriginAllowed("https://x.loca.lt", list)).toBe(true);
    expect(isOriginAllowed("https://other.trycloudflare.com", list)).toBe(false);
    expect(isOriginAllowed("not-a-url", list)).toBe(false);
  });

  test("loopback and RFC-1918 LAN are always allowed, even under an allowlist", () => {
    const list = parseAllowedOrigins("https://abc.trycloudflare.com");
    for (const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:8787",
      "http://192.168.1.20:8787",
      "http://10.0.0.5:8787",
      "http://172.16.4.9:8787",
    ]) {
      expect(isOriginAllowed(origin, list)).toBe(true);
      expect(isLocalHost(new URL(origin).host)).toBe(true);
    }
    // A public host outside the list stays blocked.
    expect(isLocalHost("8.8.8.8:80")).toBe(false);
    expect(isOriginAllowed("http://8.8.8.8", list)).toBe(false);
  });
});
