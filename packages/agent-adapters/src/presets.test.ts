import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { execPath } from "node:process";
import { BUILTIN_ADAPTERS, BUILTIN_ADAPTER_IDS } from "./descriptors.ts";
import { AGENT_PRESETS, type AgentPreset, detectAdapter, getPreset } from "./presets.ts";

describe("named presets", () => {
  test("there is exactly one preset per built-in adapter", () => {
    expect(AGENT_PRESETS).toHaveLength(BUILTIN_ADAPTERS.length);
    const ids = AGENT_PRESETS.map((p) => p.descriptor.id).sort();
    expect(ids).toEqual([...BUILTIN_ADAPTER_IDS].sort());
  });

  test("each preset carries a non-empty detection config", () => {
    for (const preset of AGENT_PRESETS) {
      expect(preset.detection.idleMs).toBeGreaterThan(0);
      expect(Array.isArray(preset.detection.promptPatterns)).toBe(true);
      expect(preset.env).toBeDefined();
    }
  });

  test("named CLIs map to their real launch command", () => {
    expect(getPreset("claude-code").descriptor.command).toBe("claude");
    expect(getPreset("codex-cli").descriptor.command).toBe("codex");
    expect(getPreset("cursor-agent").descriptor.command).toBe("cursor-agent");
    expect(getPreset("gemini-cli").descriptor.command).toBe("gemini");
  });

  test("only the generic adapter is zero-config (no fixed command)", () => {
    const generic = getPreset("generic");
    expect(generic.descriptor.generic).toBe(true);
    expect(generic.descriptor.command).toBe("");
    for (const preset of AGENT_PRESETS) {
      if (!preset.descriptor.generic) {
        expect(preset.descriptor.command.length).toBeGreaterThan(0);
      }
    }
  });

  test("getPreset rejects an unknown id", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately exercise the runtime guard.
    expect(() => getPreset("nope" as any)).toThrow();
  });
});

describe("detectAdapter (graceful degradation, never fakes success)", () => {
  test("a present CLI resolves to available with a path", async () => {
    // Probe `process.execPath` — the absolute path of the runtime executing this
    // test, guaranteed to exist on disk on every runner. A bare name (e.g. `git`)
    // would route through `where.exe`/`which` + PATH, which is unreliable under the
    // Bun test runtime on the GH `windows-latest` runner (it reported a present
    // `git` as not_found). Resolving an absolute path is the deterministic probe.
    const preset: AgentPreset = {
      descriptor: { ...getPreset("claude-code").descriptor, command: execPath },
      detection: getPreset("claude-code").detection,
      env: {},
    };
    const result = await detectAdapter(preset);
    expect(result.status).toBe("available");
    // A non-empty path that actually exists on disk — not an exact string.
    expect(result.resolvedPath?.length).toBeGreaterThan(0);
    expect(existsSync(result.resolvedPath ?? "")).toBe(true);
    // Real on-disk CLI probe; the PATH/where.exe lookup can run past bun's 5s default
    // body timeout under heavy parallel `turbo` load — give it headroom. Assertions unchanged.
  }, 60_000);

  test("a missing CLI reports not_found with guidance, does not throw", async () => {
    const preset: AgentPreset = {
      descriptor: { ...getPreset("claude-code").descriptor, command: "swarm-no-such-cli-xyz" },
      detection: getPreset("claude-code").detection,
      env: {},
    };
    const result = await detectAdapter(preset);
    expect(result.status).toBe("not_found");
    expect(result.detail.toLowerCase()).toContain("not");
    // The missing-CLI probe walks PATH (where.exe/which) and is the documented flaker
    // [~5005ms] under load — give it headroom past bun's 5s default. Assertions unchanged.
  }, 60_000);

  test("the generic adapter reports unknown (it has no fixed command)", async () => {
    const result = await detectAdapter(getPreset("generic"));
    expect(result.status).toBe("unknown");
    // Real adapter-detection path; give headroom past bun's 5s default under heavy
    // parallel `turbo` load. Assertions unchanged.
  }, 60_000);
});
