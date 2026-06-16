import { cn } from "@swarm/ui";
import { Badge, IconButton } from "@swarm/ui/react";
import { Minus, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Section } from "../components/Section";
import { useDispatch } from "../store/cockpit";

const MIN = 1;
const MAX = 120;
const DEFAULT = 12;

/**
 * A deterministic state per cell index, so the palette/order NEVER shuffle when
 * the count changes — adding agents only appends cells; existing ones hold their
 * exact position and tone. That steadiness IS the demo: crank to 120 and the
 * ordered surface refuses to flinch. ~70% running, with a steady scatter of the
 * other states by a fixed stride (no randomness — SSR and client agree).
 */
type CellTone = "running" | "attention" | "idle" | "done" | "error";

function toneForIndex(i: number): CellTone {
  if (i % 17 === 16) return "error";
  if (i % 11 === 10) return "idle";
  if (i % 7 === 6) return "done";
  if (i % 5 === 4) return "attention";
  return "running";
}

const TONE_CELL: Record<CellTone, string> = {
  running: "bg-running",
  attention: "bg-attention",
  idle: "bg-transparent ring-1 ring-inset ring-idle",
  done: "bg-success",
  error: "bg-error",
};

export function SwarmDial() {
  const dispatch = useDispatch();
  const [count, setCount] = useState(DEFAULT);
  // The pulse + entrance animation stay OFF until the first dial move (MOTION LAW).
  const [moved, setMoved] = useState(false);
  const sliderId = useId();
  const liveRef = useRef<HTMLParagraphElement>(null);

  const change = (next: number) => {
    const clamped = Math.max(MIN, Math.min(MAX, next));
    setCount(clamped);
    if (!moved) setMoved(true);
    dispatch({ type: "interact" });
  };

  const counts = useMemo(() => {
    let running = 0;
    let attention = 0;
    let idle = 0;
    let done = 0;
    let error = 0;
    for (let i = 0; i < count; i++) {
      const tone = toneForIndex(i);
      if (tone === "running") running++;
      else if (tone === "attention") attention++;
      else if (tone === "idle") idle++;
      else if (tone === "done") done++;
      else error++;
    }
    return { running, attention, idle, done, error };
  }, [count]);

  return (
    <Section
      id="swarm-dial"
      num="01"
      title="The swarm dial"
      subhead="Crank the agent count by hand — drag, or use the arrow keys. Every agent is pinned to its own .grove/wt/agent-N worktree. Watch what does not happen: the geometry, the order, the colour, the cadence hold steady from one agent to a hundred. The calm surface is the whole product."
    >
      <div className="rounded-lg border border-line bg-surface">
        {/* Stepper */}
        <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">
              agents
            </span>
            <div className="flex items-center gap-1.5">
              <IconButton
                aria-label="Fewer agents"
                size="sm"
                variant="secondary"
                onClick={() => change(count - 1)}
              >
                <Minus />
              </IconButton>
              <span className="w-12 text-center font-mono text-2xl font-semibold tabular-nums text-fg">
                {count}
              </span>
              <IconButton
                aria-label="More agents"
                size="sm"
                variant="secondary"
                onClick={() => change(count + 1)}
              >
                <Plus />
              </IconButton>
            </div>
          </div>

          <label htmlFor={sliderId} className="sr-only">
            Number of agents
          </label>
          <input
            id={sliderId}
            type="range"
            min={MIN}
            max={MAX}
            value={count}
            onChange={(e) => change(Number(e.target.value))}
            className="grove-dial-range h-1.5 min-w-[180px] flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            aria-valuetext={`${count} agents`}
          />

          {/* Pinned tally — recomputes from the same number. */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge tone="running" dot>
              {counts.running} running
            </Badge>
            <Badge tone="attention" dot>
              {counts.attention} attention
            </Badge>
            {counts.done > 0 ? (
              <Badge tone="success" dot>
                {counts.done} done
              </Badge>
            ) : null}
            {counts.idle > 0 ? (
              <Badge tone="idle" dot>
                {counts.idle} idle
              </Badge>
            ) : null}
            {counts.error > 0 ? (
              <Badge tone="error" dot>
                {counts.error} error
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Fixed-geometry grid: content-visibility keeps it steady at N=120. */}
        <div className="grove-grid-contain p-4">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(0, 1.25rem))" }}
            role="img"
            aria-label={`${count} agents, each pinned to its own worktree`}
          >
            {Array.from({ length: count }, (_, i) => {
              const tone = toneForIndex(i);
              const row = Math.floor(i / 24);
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: cell index IS the stable agent identity (agent-N never reorders)
                  key={i}
                  title={`.grove/wt/agent-${i + 1}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-sm border border-line-subtle bg-base",
                  )}
                >
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      TONE_CELL[tone],
                      // Pulse only after a dial move, and only for running cells.
                      moved && tone === "running" && "grove-pulse",
                      // Cells ease in one row at a time — gated behind the move.
                      moved && "grove-cell-in",
                    )}
                    style={moved ? { animationDelay: `${row * 60}ms` } : undefined}
                  />
                </span>
              );
            })}
          </div>
        </div>

        <p
          ref={liveRef}
          aria-live="polite"
          className="border-t border-line px-4 py-3 font-mono text-2xs tabular-nums text-fg-muted"
        >
          {count} agents · {count} worktrees · one trunk · order steady · 0 reflows
        </p>
      </div>
    </Section>
  );
}
