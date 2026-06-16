import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { RosterAgent, RosterTally } from "./fixtures";
import { ROSTER, tally } from "./fixtures";

/**
 * The cockpit store — the single source of truth every rail and section island
 * subscribes to (DESIGN.md §Architecture). Built on `useSyncExternalStore` over
 * a tiny mutable store, so it is SSR-safe (a server snapshot seeds the
 * prerender) and adds no dependency. This is what makes the cross-surface
 * cause-effect real: a section dispatches an action, every subscriber that
 * selected the touched slice re-renders — the harvest in §04 flips a row in the
 * pinned rail because both read this one store.
 */

export interface StatusLogEntry {
  readonly id: number;
  readonly text: string;
}

export interface CockpitState {
  /** The live roster (mutated by harvest; never autoplayed). */
  readonly agents: readonly RosterAgent[];
  /** Worktree id the visitor has focused (rail highlight + cross-surface). */
  readonly selectedId: string | null;
  /**
   * Whether the visitor has acted yet. The MOTION LAW: running pulses stay OFF
   * until this flips true on the first real interaction (dial move, palette,
   * row click). Nothing on this page moves before the visitor does.
   */
  readonly interacted: boolean;
  /** Bottom status-strip log (newest last). Seeded with the at-rest line. */
  readonly statusLog: readonly StatusLogEntry[];
  /** Phone pairing state for §06 (forward-faked, honestly labeled). */
  readonly paired: boolean;
}

export type CockpitAction =
  | { readonly type: "interact" }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "harvest"; readonly id: string }
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "pair"; readonly paired: boolean };

const INITIAL_LOG: readonly StatusLogEntry[] = [
  { id: 0, text: "grove · loopback:7433 · bearer · embedded postgres · 0 outbound" },
];

function initialState(): CockpitState {
  return {
    agents: ROSTER,
    selectedId: null,
    interacted: false,
    statusLog: INITIAL_LOG,
    paired: false,
  };
}

function reduce(state: CockpitState, action: CockpitAction): CockpitState {
  switch (action.type) {
    case "interact":
      return state.interacted ? state : { ...state, interacted: true };
    case "select":
      return { ...state, interacted: true, selectedId: action.id };
    case "harvest": {
      const target = state.agents.find((a) => a.id === action.id);
      // Harvest is scoped to ONE reviewed worktree per click — only a done/running
      // agent harvests; amber/error agents stay exactly as they are (honesty law).
      if (!target || target.status === "needs_attention" || target.status === "error") {
        return state;
      }
      const agents = state.agents.map((a) =>
        a.id === action.id ? { ...a, status: "done" as const } : a,
      );
      const entry: StatusLogEntry = {
        id: state.statusLog.length,
        text: `harvested ${target.branch} → main · worktree ${target.worktree} retired`,
      };
      return { ...state, interacted: true, agents, statusLog: [...state.statusLog, entry] };
    }
    case "status":
      return {
        ...state,
        statusLog: [...state.statusLog, { id: state.statusLog.length, text: action.text }],
      };
    case "pair":
      return { ...state, interacted: true, paired: action.paired };
    default:
      return state;
  }
}

interface Store {
  getState: () => CockpitState;
  subscribe: (listener: () => void) => () => void;
  dispatch: (action: CockpitAction) => void;
}

function createStore(): Store {
  let state = initialState();
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      const next = reduce(state, action);
      if (next !== state) {
        state = next;
        for (const l of listeners) l();
      }
    },
  };
}

const StoreContext = createContext<Store | null>(null);

export function CockpitProvider({ children }: { readonly children: ReactNode }) {
  // One store instance per mount; stable across renders.
  const storeRef = useRef<Store | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createStore();
  }
  return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>;
}

function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("Cockpit hooks must be used within <CockpitProvider>");
  }
  return store;
}

/** Subscribe to a derived slice of cockpit state. */
export function useCockpit<T>(selector: (state: CockpitState) => T): T {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

/** The action dispatcher — stable, safe to use in deps. */
export function useDispatch(): (action: CockpitAction) => void {
  return useStore().dispatch;
}

// --- selectors (memo-free; values are primitives or stable refs) ---

export function useAgents(): readonly RosterAgent[] {
  return useCockpit((s) => s.agents);
}

export function useSelectedId(): string | null {
  return useCockpit((s) => s.selectedId);
}

export function useInteracted(): boolean {
  return useCockpit((s) => s.interacted);
}

export function usePaired(): boolean {
  return useCockpit((s) => s.paired);
}

export function useStatusLog(): readonly StatusLogEntry[] {
  return useCockpit((s) => s.statusLog);
}

/** The live tally for the status rail + dial caption, recomputed from the roster. */
export function useTally(): RosterTally {
  const agents = useAgents();
  return useMemo(() => tally(agents), [agents]);
}

// --- shared rAF clock ---------------------------------------------------------

/**
 * One requestAnimationFrame loop drives every elapsed timer on the page (NOT N
 * setIntervals — DESIGN.md). It publishes a coarse "tick" (~250ms) so seconds
 * advance without re-rendering on every frame. Honest wall-clock motion: the
 * only thing on the page allowed to change unprompted (the MOTION LAW carve-out
 * for ticking numbers). Reduced-motion users still get correct values; the
 * number simply updates without being an animation.
 */
class Clock {
  private listeners = new Set<() => void>();
  private origin = Date.now();
  private raf: number | null = null;
  private last = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  /** Epoch-ish milliseconds; snapshots are referentially stable within a frame window. */
  getSnapshot = (): number => this.nowEpoch;

  getServerSnapshot = (): number => 0;

  private nowEpoch = Date.now();

  private start() {
    const loop = (t: number) => {
      if (t - this.last >= 250) {
        this.last = t;
        this.nowEpoch = this.origin + t;
        for (const l of this.listeners) l();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }
}

const ClockContext = createContext<Clock | null>(null);

export function ClockProvider({ children }: { readonly children: ReactNode }) {
  const ref = useRef<Clock | null>(null);
  if (ref.current === null) ref.current = new Clock();
  return <ClockContext.Provider value={ref.current}>{children}</ClockContext.Provider>;
}

/**
 * Subscribe to the shared clock. Returns epoch-ish ms that advances ~4x/sec
 * once any timer is mounted. On the server it returns 0, so SSR renders the
 * "at first paint" baseline and hydration takes over live.
 */
export function useClock(): number {
  const clock = useContext(ClockContext);
  if (!clock) {
    throw new Error("useClock must be used within <ClockProvider>");
  }
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getServerSnapshot);
}

/**
 * Elapsed seconds for a run that began `startedAtOffsetMs` before first paint.
 * Pinned to the shared clock; the page mount time is captured once so every
 * timer shares an origin and they all advance together.
 */
let MOUNT_EPOCH = 0;
export function setMountEpoch(epoch: number) {
  MOUNT_EPOCH = epoch;
}

export function useElapsed(startedAtOffsetMs: number): number {
  const now = useClock();
  // Before hydration (now === 0) show the baseline; after, advance live.
  const base = now === 0 ? 0 : now - MOUNT_EPOCH;
  return Math.max(0, Math.floor((startedAtOffsetMs + base) / 1000));
}

/** A small effect that records the page mount epoch once, for the shared clock. */
export function useMountEpoch() {
  useEffect(() => {
    setMountEpoch(Date.now());
  }, []);
}
