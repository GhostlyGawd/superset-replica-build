import { describe, expect, test } from "bun:test";
import { asId, err, normalizeEol, ok, toPosixPath } from "./index";

describe("@swarm/shared", () => {
  test("toPosixPath converts Windows separators", () => {
    expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
  });

  test("normalizeEol collapses CRLF to LF", () => {
    expect(normalizeEol("line-1\r\nline-2")).toBe("line-1\nline-2");
  });

  test("Result helpers discriminate ok and err", () => {
    const good = ok(42);
    const bad = err(new Error("nope"));
    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
    if (good.ok) {
      expect(good.value).toBe(42);
    }
  });

  test("asId brands a raw string without altering its value", () => {
    const id: string = asId<"ProjectId">("p_1");
    expect(id).toBe("p_1");
  });
});
