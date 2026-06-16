import { cn } from "@swarm/ui";
import { AgentStatusDot, ListRow, ThemeToggle } from "@swarm/ui/react";
import { ChevronDown, Command } from "lucide-react";
import type { ReactNode } from "react";
import { emit } from "../lib/bus";
import { formatWallClock } from "../lib/format";
import { SECTIONS, focusSection } from "../lib/sections";
import {
  useAgents,
  useClock,
  useDispatch,
  useSelectedId,
  useStatusLog,
  useTally,
} from "../store/cockpit";
import { GroveMark } from "./GroveMark";

/**
 * The persistent cockpit frame. Top STATUS RAIL · left WORKSPACE RAIL · center
 * CONTENT WELL · bottom STATUS STRIP — the chrome never leaves the screen while
 * documentary sections scroll through the well. The rails are sticky over the
 * NATIVE document scroll (not an inner scroll container), so the page reads as
 * operating a console, not paging a website.
 */
export function CockpitShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-base text-fg">
      <StatusRail />
      <div className="mx-auto flex w-full max-w-[1440px]">
        <WorkspaceRail />
        <main className="min-w-0 flex-1 border-l border-line">{children}</main>
      </div>
      <StatusStrip />
    </div>
  );
}

function StatusRail() {
  const t = useTally();
  return (
    <header className="sticky top-0 z-40 h-10 border-b border-line bg-base">
      <div className="mx-auto flex h-10 w-full max-w-[1440px] items-center gap-3 px-3">
        <div className="flex shrink-0 items-center gap-2">
          <GroveMark size={16} />
          <span className="font-mono text-sm font-medium tracking-tight text-fg">grove</span>
          <span className="font-mono text-2xs text-fg-subtle">v1.0.0</span>
        </div>

        {/* Center: the live swarm tally, tabular figures — the at-a-glance state. */}
        <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
          <p className="truncate font-mono text-xs tabular-nums text-fg-muted">
            <span className="text-fg">{t.total}</span> agents
            <span className="text-fg-subtle"> · </span>
            <span className="text-running-fg">{t.running} running</span>
            <span className="text-fg-subtle"> · </span>
            <span className="text-attention-fg">{t.attention} attention</span>
            <span className="text-fg-subtle"> · </span>
            <span className="text-idle-fg">{t.idle} idle</span>
            {t.done > 0 ? (
              <>
                <span className="text-fg-subtle"> · </span>
                <span className="text-success-fg">{t.done} done</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-2xs text-fg-muted sm:inline-flex">
            <span className="size-1.5 rounded-full bg-success" aria-hidden />
            loopback:7433 · paired
          </span>
          <button
            type="button"
            onClick={() => emit({ type: "open-palette" })}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 font-mono text-2xs text-fg-muted transition-colors duration-fast hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-base"
            aria-label="Open command palette"
          >
            <Command aria-hidden className="size-3" />K
          </button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function WorkspaceRail() {
  const agents = useAgents();
  const selectedId = useSelectedId();
  const dispatch = useDispatch();

  return (
    <aside className="sticky top-10 hidden h-[calc(100dvh-2.5rem)] w-[220px] shrink-0 flex-col bg-base lg:flex">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">worktrees</span>
        <span className="font-mono text-2xs tabular-nums text-fg-subtle">{agents.length}</span>
      </div>
      <nav
        aria-label="Worktrees"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-1.5 pb-3"
      >
        {agents.map((a) => (
          <ListRow
            key={a.id}
            selected={selectedId === a.id}
            onSelect={() => {
              dispatch({ type: "select", id: selectedId === a.id ? null : a.id });
              focusSection("cold-open");
            }}
            leading={<AgentStatusDot status={a.status} />}
            trailing={
              a.status === "done" ? (
                <span className="font-mono text-2xs text-success-fg">done</span>
              ) : null
            }
          >
            <span className="font-mono text-xs">{a.branch}</span>
          </ListRow>
        ))}
      </nav>
    </aside>
  );
}

function StatusStrip() {
  const epoch = useClock();
  const log = useStatusLog();
  const latest = log[log.length - 1];
  const baseLine = log[0];
  // Before hydration the clock is 0; render a stable fixed-width dash row.
  const clock = epoch === 0 ? "--:--:--" : formatWallClock(epoch);

  return (
    <footer className="sticky bottom-0 z-40 h-7 border-t border-line bg-base">
      <div className="mx-auto flex h-7 w-full max-w-[1440px] items-center gap-3 px-3 font-mono text-2xs text-fg-subtle">
        <span className="truncate text-fg-muted">{baseLine?.text}</span>
        {latest && latest.id !== 0 ? (
          <span className="hidden truncate text-success-fg md:inline" aria-live="polite">
            {latest.text}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
          <span aria-label="Swarm clock">{clock}</span>
          <ScrollChevron />
        </span>
      </div>
    </footer>
  );
}

/**
 * The down-chevron scroll affordance. It advances to the next pane below the
 * current viewport position (a PULL), and becomes "return to top" once the
 * install section is reached.
 */
function ScrollChevron() {
  const onClick = () => {
    if (typeof window === "undefined") return;
    const mid = window.scrollY + window.innerHeight * 0.5;
    // Find the first section whose top is below the current midpoint.
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el && el.offsetTop > mid + 8) {
        focusSection(s.id);
        return;
      }
    }
    // Past the last pane — return to the top.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to next pane"
      className={cn(
        "inline-flex size-5 items-center justify-center rounded text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-base",
      )}
    >
      <ChevronDown aria-hidden className="size-3.5" />
    </button>
  );
}
