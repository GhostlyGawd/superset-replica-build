import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type SwarmConfig, mergeConfig, parseConfig, parseOverlay } from "./index";

describe("@swarm/config parseConfig", () => {
  test("parses arrays of string commands and defaults missing fields", () => {
    const result = parseConfig({
      setup: ["bun install", 'cp "$SWARM_ROOT_PATH/.env" .env'],
      teardown: ["bun run db:reset"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.setup).toEqual(["bun install", 'cp "$SWARM_ROOT_PATH/.env" .env']);
      expect(result.value.teardown).toEqual(["bun run db:reset"]);
      expect(result.value.run).toEqual([]);
    }
  });

  test("parses a per-OS command with a shell-specific Windows line", () => {
    const result = parseConfig({
      run: [{ windows: { run: "./scripts/dev.ps1", shell: "pwsh" }, posix: "./scripts/dev.ts" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.run).toEqual([
        { windows: { run: "./scripts/dev.ps1", shell: "pwsh" }, posix: "./scripts/dev.ts" },
      ]);
    }
  });

  test("rejects an unknown top-level field", () => {
    const result = parseConfig({ setup: [], bogus: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe("bogus");
    }
  });

  test("rejects a command that is neither a string nor an object", () => {
    const result = parseConfig({ setup: [42] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe("setup[0]");
    }
  });

  test("rejects an unknown shell on a per-OS command", () => {
    const result = parseConfig({ setup: [{ windows: { run: "echo hi", shell: "fish" } }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe("setup[0].windows.shell");
    }
  });

  test("rejects a per-OS command that sets neither windows nor posix", () => {
    const result = parseConfig({ setup: [{}] });
    expect(result.ok).toBe(false);
  });
});

describe("@swarm/config mergeConfig", () => {
  test("overlay before/after prepend and append per field", () => {
    const base: SwarmConfig = { setup: ["bun install"], teardown: [], run: ["bun dev"] };
    const overlay = parseOverlay({
      setup: { before: ["echo pre"], after: ["echo post"] },
      run: { after: ["echo done"] },
    });
    expect(overlay.ok).toBe(true);
    if (overlay.ok) {
      const merged = mergeConfig(base, overlay.value);
      expect(merged.setup).toEqual(["echo pre", "bun install", "echo post"]);
      expect(merged.run).toEqual(["bun dev", "echo done"]);
      expect(merged.teardown).toEqual([]);
    }
  });

  test("an empty overlay leaves the base unchanged", () => {
    const base: SwarmConfig = { setup: ["a"], teardown: ["b"], run: ["c"] };
    expect(mergeConfig(base, {})).toEqual(base);
  });

  test("DEFAULT_CONFIG is every phase present with no commands", () => {
    expect(DEFAULT_CONFIG).toEqual({ setup: [], teardown: [], run: [] });
  });
});
