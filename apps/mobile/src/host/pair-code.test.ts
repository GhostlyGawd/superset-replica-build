import { describe, expect, it } from "bun:test";
import { codeFromUrl, sanitizeCode } from "./pair-code.ts";

describe("sanitizeCode", () => {
  it("uppercases and strips spaces + dashes", () => {
    expect(sanitizeCode("ab cd-ef gh")).toBe("ABCDEFGH");
    expect(sanitizeCode("  7h3k-9m2p ")).toBe("7H3K9M2P");
  });

  it("is idempotent on an already-canonical code", () => {
    expect(sanitizeCode("ABCD2345")).toBe("ABCD2345");
  });
});

describe("codeFromUrl", () => {
  it("reads + sanitizes a ?code= query the QR encodes", () => {
    expect(codeFromUrl("http://192.168.1.20:8787/?code=7h3k9m2p")).toBe("7H3K9M2P");
  });

  it("falls back to a #code= hash", () => {
    expect(codeFromUrl("http://localhost:8787/#code=abcd2345")).toBe("ABCD2345");
  });

  it("returns empty string when there is no code", () => {
    expect(codeFromUrl("http://localhost:8787/")).toBe("");
    expect(codeFromUrl("not a url")).toBe("");
  });

  it("parses a bare query string", () => {
    expect(codeFromUrl("?code=zz99zz99")).toBe("ZZ99ZZ99");
  });
});
