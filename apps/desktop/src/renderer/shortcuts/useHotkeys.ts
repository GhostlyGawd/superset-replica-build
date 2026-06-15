import { useCallback, useEffect, useMemo, useState } from "react";
import type { HostTrpcClient } from "../../host-client.ts";
import { DEFAULT_CHORDS, type HotkeyBindings } from "./registry.ts";

export type HotkeyPhase = "loading" | "ready" | "error";

export interface HotkeyController {
  /** Merged bindings: defaults overlaid with the user's persisted overrides. */
  readonly bindings: HotkeyBindings;
  /** Just the user's overrides (id → chord), for the Settings dialog's reset UI. */
  readonly overrides: HotkeyBindings;
  readonly phase: HotkeyPhase;
  readonly error: string | null;
  /** Re-fetch overrides from the host (e.g. after a reconnect). */
  reload(): void;
  /** Persist one binding to the host, then reflect it locally. */
  setBinding(actionId: string, chord: string): Promise<void>;
  /** Clear one override (revert to default) on the host, then locally. */
  resetBinding(actionId: string): Promise<void>;
  /** Clear every override on the host, then locally. */
  resetAll(): Promise<void>;
}

/**
 * Owns the desktop hotkey configuration: loads persisted overrides from the host
 * `settings` router on mount, merges them over the default registry, and persists
 * rebinds/resets. Until a host is connected (or while loading) the merged config
 * is just the defaults, so the keymaps always work.
 */
export function useHotkeys(client: HostTrpcClient | null): HotkeyController {
  const [overrides, setOverrides] = useState<HotkeyBindings>({});
  const [phase, setPhase] = useState<HotkeyPhase>(client ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refetch is intentionally re-keyed on the reload nonce; the body uses only `client` + stable setters.
  useEffect(() => {
    if (!client) {
      setOverrides({});
      setPhase("ready");
      setError(null);
      return;
    }
    let cancelled = false;
    setPhase("loading");
    setError(null);
    void (async () => {
      try {
        const rows = await client.settings.getHotkeys.query();
        if (cancelled) {
          return;
        }
        setOverrides(Object.fromEntries(rows.map((row) => [row.actionId, row.binding])));
        setPhase("ready");
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, nonce]);

  const bindings = useMemo<HotkeyBindings>(
    () => ({ ...DEFAULT_CHORDS, ...overrides }),
    [overrides],
  );

  const setBinding = useCallback(
    async (actionId: string, chord: string) => {
      if (!client) {
        throw new Error("Not connected to a host — cannot save shortcuts.");
      }
      await client.settings.setHotkey.mutate({ actionId, binding: chord });
      setOverrides((prev) => ({ ...prev, [actionId]: chord }));
    },
    [client],
  );

  const resetBinding = useCallback(
    async (actionId: string) => {
      if (!client) {
        throw new Error("Not connected to a host — cannot reset shortcuts.");
      }
      await client.settings.resetHotkey.mutate({ actionId });
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[actionId];
        return next;
      });
    },
    [client],
  );

  const resetAll = useCallback(async () => {
    if (!client) {
      throw new Error("Not connected to a host — cannot reset shortcuts.");
    }
    await client.settings.resetHotkeys.mutate();
    setOverrides({});
  }, [client]);

  return { bindings, overrides, phase, error, reload, setBinding, resetBinding, resetAll };
}
