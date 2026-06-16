import type { WorkspaceStatus } from "@swarm/db";
import {
  AgentStatusDot,
  Badge,
  IconButton,
  ListRow,
  Select,
  StatusBadge,
  useToast,
} from "@swarm/ui/react";
import { Bell } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "../components/Section";
import { on } from "../lib/bus";
import { focusSection } from "../lib/sections";
import { useAgents, useDispatch, useTally } from "../store/cockpit";
import type { RosterAgent } from "../store/fixtures";

const LEGEND: readonly WorkspaceStatus[] = ["running", "needs_attention", "idle", "done", "error"];

type GroupBy = "status" | "agent" | "host";

export function Monitoring() {
  const agents = useAgents();
  const tally = useTally();
  const dispatch = useDispatch();
  const { toast } = useToast();
  const [groupBy, setGroupBy] = useState<GroupBy>("status");

  // The attention queue is derived from the same store every other pane reads.
  const queue = useMemo(
    () => agents.filter((a) => a.status === "needs_attention" || a.status === "error"),
    [agents],
  );

  const simulate = () => {
    const first = queue[0];
    dispatch({ type: "interact" });
    toast({
      tone: "attention",
      title: first ? `${first.agent} needs you` : "Agent needs you",
      description: first
        ? `${first.branch} paused — waiting on input. Opening its worktree.`
        : "An agent paused — waiting on input.",
    });
    if (first) {
      dispatch({ type: "select", id: first.id });
      focusSection("cold-open");
    }
  };

  // Palette `status` verb fires the same single notification (pull-only).
  const simulateRef = useRef(simulate);
  simulateRef.current = simulate;
  useEffect(() => on((e) => e.type === "simulate-notification" && simulateRef.current()), []);

  const groups = useMemo(() => groupAgents(agents, groupBy), [agents, groupBy]);

  return (
    <Section
      id="monitoring"
      num="05"
      title="Monitoring & attention"
      subhead="One board for the whole swarm. State is triple-encoded — colour, word, and shape — so it never relies on colour alone. The board reads from the same source of truth as the rest of the cockpit; a notification is a pull, fired on request, never pushed at you."
    >
      {/* Legend: every state, color + word + shape. */}
      <div className="flex flex-wrap items-center gap-2">
        {LEGEND.map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </div>

      {/* Tabular counts strip. */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Count label="agents" value={tally.total} tone="text-fg" />
        <Count label="running" value={tally.running} tone="text-running-fg" />
        <Count label="attention" value={tally.attention} tone="text-attention-fg" />
        <Count label="idle" value={tally.idle} tone="text-idle-fg" />
        <Count label="done" value={tally.done} tone="text-success-fg" />
        <Count label="error" value={tally.error} tone="text-error-fg" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Attention queue */}
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">
              attention queue
            </span>
            <IconButton
              aria-label="Simulate a notification"
              size="sm"
              variant="secondary"
              onClick={simulate}
            >
              <Bell />
            </IconButton>
          </div>
          <div className="flex flex-col gap-0.5 p-1.5">
            {queue.length === 0 ? (
              <p className="px-2 py-3 text-xs text-fg-subtle">Nothing waiting on you.</p>
            ) : (
              queue.map((a) => (
                <ListRow
                  key={a.id}
                  leading={<AgentStatusDot status={a.status} />}
                  trailing={<StatusBadge status={a.status} />}
                  onSelect={() => {
                    dispatch({ type: "select", id: a.id });
                    focusSection("cold-open");
                  }}
                >
                  <span className="font-mono text-xs">{a.branch}</span>
                </ListRow>
              ))
            )}
          </div>
          <div className="border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={simulate}
              className="font-mono text-2xs text-fg-subtle transition-colors duration-fast hover:text-fg"
            >
              simulate a notification →
            </button>
          </div>
        </div>

        {/* Grouped board */}
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">board</span>
            <span className="flex items-center gap-2 text-2xs text-fg-subtle">
              group by
              <Select
                aria-label="Group the board by"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                className="h-7 w-28 text-xs"
              >
                <option value="status">status</option>
                <option value="agent">repo / agent</option>
                <option value="host">host</option>
              </Select>
            </span>
          </div>
          <div className="flex flex-col gap-3 p-3">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">
                    {g.key}
                  </span>
                  <Badge tone="neutral">{g.items.length}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 font-mono text-2xs text-fg-muted"
                    >
                      <AgentStatusDot status={a.status} size="sm" />
                      {a.branch}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: string;
}) {
  return (
    <div className="rounded-md border border-line-subtle bg-inset px-3 py-2">
      <p className={`font-mono text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">{label}</p>
    </div>
  );
}

interface Group {
  readonly key: string;
  readonly items: readonly RosterAgent[];
}

function groupAgents(agents: readonly RosterAgent[], by: GroupBy): readonly Group[] {
  const map = new Map<string, RosterAgent[]>();
  const keyOf = (a: RosterAgent) =>
    by === "status" ? a.status.replace("_", " ") : by === "agent" ? a.agent : "loopback:7433";
  for (const a of agents) {
    const k = keyOf(a);
    const list = map.get(k) ?? [];
    list.push(a);
    map.set(k, list);
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }));
}
