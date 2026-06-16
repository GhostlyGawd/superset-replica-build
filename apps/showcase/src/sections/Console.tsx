import {
  AgentStatusDot,
  Badge,
  Button,
  DiffView,
  IconButton,
  ListRow,
  StatusBadge,
  TerminalFrame,
} from "@swarm/ui/react";
import {
  Boxes,
  GitCompare,
  Plus,
  Search,
  Settings,
  SplitSquareHorizontal,
  TerminalSquare,
} from "lucide-react";
import { useState } from "react";
import { TerminalBody } from "../TerminalBody";
import { SAMPLE_DIFF, WORKSPACES } from "../data";
import { Section, Subsection } from "../kit";

export function Console() {
  return (
    <Section
      id="console"
      kicker="04 — Composition"
      title="The console, in situ"
      description="The primitives composed into the real product shell at desktop and phone widths — the density and rhythm the system is tuned for."
    >
      <Subsection title="Desktop — workspace rail + terminal + diff">
        <DesktopConsole />
      </Subsection>
      <Subsection title="Phone — 390px, bottom navigation, larger touch targets">
        <PhoneConsole />
      </Subsection>
    </Section>
  );
}

function DesktopConsole() {
  const [selected, setSelected] = useState("w1");
  const active = WORKSPACES.find((ws) => ws.id === selected) ?? WORKSPACES[0];

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-base shadow-lg">
      <div className="flex h-8 items-center justify-center border-b border-line bg-surface">
        <span className="font-mono text-2xs text-fg-subtle">grove — orchestrating 5 worktrees</span>
      </div>
      <div className="flex h-[540px]">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
          <header className="flex h-10 items-center justify-between gap-2 border-b border-line px-3">
            <span className="flex items-center gap-2 truncate text-sm font-semibold text-fg">
              <Boxes className="size-4 text-accent-fg" />
              grove
            </span>
            <IconButton aria-label="New workspace" size="sm">
              <Plus />
            </IconButton>
          </header>
          <div className="flex flex-1 flex-col gap-0.5 overflow-auto p-1.5">
            {WORKSPACES.map((ws) => (
              <ListRow
                key={ws.id}
                selected={selected === ws.id}
                onSelect={() => setSelected(ws.id)}
                leading={<AgentStatusDot status={ws.status} />}
                trailing={<span className="font-mono text-2xs text-fg-subtle">{ws.meta}</span>}
              >
                {ws.name}
              </ListRow>
            ))}
          </div>
          <footer className="border-t border-line p-2">
            <Button variant="secondary" size="sm" icon={<Plus />} className="w-full">
              New workspace
            </Button>
          </footer>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-base">
          <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-fg">{active?.name}</span>
              <Badge tone="neutral">{active?.branch}</Badge>
              {active ? <StatusBadge status={active.status} /> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton aria-label="Search" size="sm">
                <Search />
              </IconButton>
              <IconButton aria-label="Split" size="sm">
                <SplitSquareHorizontal />
              </IconButton>
              <IconButton aria-label="Settings" size="sm">
                <Settings />
              </IconButton>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[1.25fr_1fr] gap-3 p-3">
            <TerminalFrame
              tabs={[
                { id: "t1", label: "pwsh" },
                { id: "t2", label: "claude" },
              ]}
              activeTab="t1"
              shell="pwsh"
              cwd="D:\\src\\app"
              connected
              className="min-h-0"
            >
              <TerminalBody />
            </TerminalFrame>
            <DiffView
              path={SAMPLE_DIFF.path}
              changeType={SAMPLE_DIFF.changeType}
              additions={SAMPLE_DIFF.additions}
              deletions={SAMPLE_DIFF.deletions}
              lines={SAMPLE_DIFF.lines}
              className="min-h-0"
            />
          </div>
        </main>
      </div>
    </div>
  );
}

const PHONE_NAV = [
  { id: "ws", label: "Workspaces", icon: Boxes },
  { id: "term", label: "Terminal", icon: TerminalSquare },
  { id: "diff", label: "Diff", icon: GitCompare },
];

function PhoneConsole() {
  const [tab, setTab] = useState("term");
  const active = WORKSPACES[0];

  return (
    <div className="mx-auto w-[390px] max-w-full">
      <div className="overflow-hidden rounded-[2rem] border-[6px] border-line-strong bg-base shadow-lg">
        <div className="flex h-[760px] flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)]">
            <span className="flex min-w-0 items-center gap-2">
              <AgentStatusDot status={active?.status ?? "idle"} />
              <span className="truncate text-base font-semibold text-fg">{active?.name}</span>
            </span>
            {active ? <StatusBadge status={active.status} /> : null}
          </header>

          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-surface px-3 py-2">
            {WORKSPACES.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-xs text-fg-muted"
              >
                <AgentStatusDot status={ws.status} size="sm" />
                {ws.name}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 p-2">
            <TerminalFrame
              shell="pwsh"
              cwd="~/app"
              cols={48}
              rows={28}
              connected
              className="h-full"
            >
              <TerminalBody />
            </TerminalFrame>
          </div>

          <nav className="grid shrink-0 grid-cols-3 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
            {PHONE_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-14 flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors duration-fast ${
                    isActive ? "text-accent-fg" : "text-fg-subtle"
                  }`}
                >
                  <Icon className="size-5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
