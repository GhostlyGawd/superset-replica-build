import { describe, expect, test } from "bun:test";
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
    // `node` is guaranteed present in this toolchain; reuse the claude descriptor shape.
    const preset: AgentPreset = {
      descriptor: { ...getPreset("claude-code").descriptor, command: "node" },
      detection: getPreset("claude-code").detection,
      env: {},
    };
    const result = await detectAdapter(preset);
    expect(result.status).toBe("available");
    expect(result.resolvedPath?.length).toBeGreaterThan(0);
  });

  test("a missing CLI reports not_found with guidance, does not throw", async () => {
    const preset: AgentPreset = {
      descriptor: { ...getPreset("claude-code").descriptor, command: "swarm-no-such-cli-xyz" },
      detection: getPreset("claude-code").detection,
      env: {},
    };
    const result = await detectAdapter(preset);
    expect(result.status).toBe("not_found");
    expect(result.detail.toLowerCase()).toContain("not");
  });

  test("the generic adapter reports unknown (it has no fixed command)", async () => {
    const result = await detectAdapter(getPreset("generic"));
    expect(result.status).toBe("unknown");
  });
});
