import type { WorkspaceStatus } from "@swarm/db";
import {
  Button,
  Select,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tooltip,
} from "@swarm/ui/react";
import { useMemo, useState } from "react";
import { Section } from "../components/Section";
import { formatElapsed } from "../lib/format";
import { useAgents, useDispatch, useElapsed, useSelectedId } from "../store/cockpit";
import type { RosterAgent } from "../store/fixtures";

/** Sort priority when grouping by attention — the agents that need you, first. */
const ATTENTION_ORDER: Record<WorkspaceStatus, number> = {
  needs_attention: 0,
  error: 1,
  running: 2,
  done: 3,
  idle: 4,
};

type SortMode = "default" | "attention";

export function ColdOpen() {
  const agents = useAgents();
  const [sort, setSort] = useState<SortMode>("default");

  const ordered = useMemo(() => {
    if (sort === "default") return agents;
    return [...agents].sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status]);
  }, [agents, sort]);

  return (
    <Section
      id="cold-open"
      num="00"
      // The ONE 30px headline on the page (DESIGN.md §type — exactly once).
      title="Run a swarm of coding agents. Keep one calm surface."
      headingClassName="text-3xl leading-tight max-w-3xl"
      subhead="Grove runs Claude Code, Codex, Cursor — any CLI agent — in parallel, each pinned to its own git worktree so they never collide. This roster is live: the elapsed timers below are a real wall-clock, ticking. Nothing else moves until you do."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={
            <span className="font-mono text-xs" aria-hidden>
              $
            </span>
          }
          onClick={() => {
            navigator.clipboard?.writeText("grove up").catch(() => undefined);
          }}
        >
          <span className="font-mono">grove up</span>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const el = document.getElementById("install");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          Read the docs
        </Button>
        <span className="ml-1 font-mono text-2xs text-fg-subtle">
          self-hosted · loopback · embedded Postgres
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">
            agent roster
          </span>
          <span className="flex items-center gap-2 text-2xs text-fg-subtle">
            sort
            <Select
              aria-label="Sort the roster"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="h-7 w-40 text-xs"
            >
              <option value="default">by worktree</option>
              <option value="attention">by attention</option>
            </Select>
          </span>
        </div>
        {/* Keyboard-focusable scroll region: the dense roster can overflow on a
            phone, so it must be scrollable without a pointer (axe
            scrollable-region-focusable). */}
        <div
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable so it can be scrolled by keyboard
          tabIndex={0}
          aria-label="Agent roster, scrollable"
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
        >
          <Table>
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell className="w-[140px]">Status</TableHeaderCell>
                <TableHeaderCell className="w-[130px]">Agent</TableHeaderCell>
                <TableHeaderCell>Worktree</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Run</TableHeaderCell>
                <TableHeaderCell className="w-[96px] text-right">Δ</TableHeaderCell>
                <TableHeaderCell className="w-[88px] text-right">Elapsed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordered.map((a) => (
                <RosterRow key={a.id} agent={a} />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        Click a row to pin its worktree in the rail · hover a worktree for its path
      </p>
    </Section>
  );
}

function RosterRow({ agent }: { readonly agent: RosterAgent }) {
  const dispatch = useDispatch();
  const selectedId = useSelectedId();
  const elapsed = useElapsed(agent.startedAtOffsetMs);
  const selected = selectedId === agent.id;

  return (
    <TableRow
      className={selected ? "bg-accent-bg hover:bg-accent-bg" : "cursor-pointer"}
      aria-selected={selected}
      onClick={() => dispatch({ type: "select", id: selected ? null : agent.id })}
    >
      <TableCell>
        <StatusBadge status={agent.status} />
      </TableCell>
      <TableCell className="text-fg-muted">{agent.agent}</TableCell>
      <TableCell>
        <Tooltip label={agent.worktree}>
          <span className="cursor-default font-mono text-xs text-fg">{agent.branch}</span>
        </Tooltip>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="font-mono text-2xs text-fg-subtle">{agent.run}</span>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono text-2xs tabular-nums">
          <span className="text-diff-add">+{agent.additions}</span>{" "}
          <span className="text-diff-remove">-{agent.deletions}</span>
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {agent.status === "idle" ? "—" : formatElapsed(elapsed)}
        </span>
      </TableCell>
    </TableRow>
  );
}
