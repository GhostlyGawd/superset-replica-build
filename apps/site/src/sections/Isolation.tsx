import {
  Badge,
  CodeBlock,
  DiffView,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@swarm/ui/react";
import { AlertTriangle, GitFork, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Section } from "../components/Section";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { ISOLATED_DIFF, SHARED_DIFF } from "../store/fixtures";

type Mode = "grove" | "shared";

const WORKTREE_LAYOUT = `.git/worktrees/
├── auth-flow/       → fix/auth-flow      (Claude Code)
├── port-scanner/    → feat/ports         (Codex)
├── diff-virtualize/ → perf/diff          (Cursor)
├── sync-resume/     → feat/sync          (Gemini)
└── adapter-codex/   → feat/adapter-codex (opencode)

# one repo · one trunk · N working trees
# each agent edits only its own checkout`;

const SHARED_LAYOUT = `working tree (one checkout)
└── src/session.ts   ← auth-flow  (Claude Code)
                      ← port-scanner (Codex)   << same file
                      ← sync-resume  (Gemini)  << same file

# one repo · one trunk · ONE working tree
# every agent edits the SAME checkout — they race`;

/** The four agents pinned to the fork, in render order (stable across modes). */
const FORK_AGENTS = [
  { id: "auth-flow", label: "auth-flow" },
  { id: "port-scanner", label: "port-scanner" },
  { id: "sync-resume", label: "sync-resume" },
  { id: "adapter-codex", label: "adapter-codex" },
] as const;

/**
 * The brand mark enacted as the section thesis: the trunk forks into one shoot
 * per agent. In Grove mode each shoot ends in its OWN isolated worktree node
 * (green, calm). Flip to a shared checkout and every shoot converges on a single
 * node (amber, contended) — the collision the product removes. Pure SVG, no
 * autoplay: it is a static diagram that changes only on the toggle click.
 */
function ForkVisual({ isolated }: { readonly isolated: boolean }) {
  // Vertical band per agent; the trunk runs up the left, shoots branch right.
  const rowH = 34;
  const top = 18;
  const trunkX = 26;
  const branchX = 96;
  const tipX = isolated ? 150 : 132;
  const height = top * 2 + (FORK_AGENTS.length - 1) * rowH;
  const sharedNodeY = top + ((FORK_AGENTS.length - 1) * rowH) / 2;

  return (
    <svg
      viewBox={`0 0 220 ${height}`}
      className="w-full"
      role="img"
      aria-label={
        isolated
          ? "One trunk forking into four isolated worktrees, one per agent"
          : "Four agents all branching onto a single shared checkout"
      }
    >
      <title>{isolated ? "per-worktree fork" : "shared-checkout collision"}</title>
      {/* Trunk */}
      <line
        x1={trunkX}
        y1={top - 6}
        x2={trunkX}
        y2={height - top + 6}
        stroke="var(--color-accent-fg)"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      {FORK_AGENTS.map((agent, i) => {
        const y = top + i * rowH;
        const nodeY = isolated ? y : sharedNodeY;
        return (
          <g key={agent.id}>
            {/* shoot from trunk out to the node */}
            <path
              d={`M ${trunkX} ${y} L ${branchX} ${y} L ${tipX - 12} ${nodeY}`}
              fill="none"
              stroke={isolated ? "var(--color-line-strong)" : "var(--color-attention)"}
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* agent label */}
            <text
              x={branchX + 2}
              y={y - 6}
              className="fill-[var(--color-fg-subtle)] font-mono"
              style={{ fontSize: "8px" }}
            >
              {agent.label}
            </text>
            {/* per-agent isolated node (only in Grove mode) */}
            {isolated ? <circle cx={tipX} cy={y} r={4} fill="var(--color-success)" /> : null}
          </g>
        );
      })}
      {/* shared collision node (only in shared mode) — one checkout, contended */}
      {isolated ? null : (
        <>
          <circle
            cx={tipX}
            cy={sharedNodeY}
            r={6}
            fill="var(--color-attention-bg)"
            stroke="var(--color-attention)"
            strokeWidth={1.4}
          />
          <text
            x={tipX + 12}
            y={sharedNodeY + 3}
            className="fill-[var(--color-attention-fg)] font-mono"
            style={{ fontSize: "8px" }}
          >
            one checkout
          </text>
        </>
      )}
    </svg>
  );
}

export function Isolation() {
  const [mode, setMode] = useState<Mode>("grove");
  const isolated = mode === "grove";
  const diff = isolated ? ISOLATED_DIFF : SHARED_DIFF;

  return (
    <Section
      id="isolation"
      num="02"
      title="Every agent on its own worktree"
      subhead="The trunk forks into one working tree per agent. They share history, never a checkout — so two agents editing the same file is a non-event, not a merge conflict. Flip to a shared checkout to see the failure mode Grove removes."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedToggle
          ariaLabel="Checkout strategy"
          options={[
            { value: "grove", label: "per-worktree (Grove)" },
            { value: "shared", label: "shared checkout" },
          ]}
          value={mode}
          onChange={setMode}
        />
        {/* Triple-encoded status (color + word + icon shape), no color-alone and
            no autoplay spinner: isolated=green/shield, collision risk=amber/alert. */}
        {isolated ? (
          <Badge tone="success" dot>
            <ShieldCheck aria-hidden className="size-3" /> isolated
          </Badge>
        ) : (
          <Badge tone="attention" dot>
            <AlertTriangle aria-hidden className="size-3" /> collision risk
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="min-h-[280px]">
          <PanelHeader>
            <PanelTitle icon={<GitFork />}>
              {isolated ? "5 worktrees, one trunk" : "5 agents, one checkout"}
            </PanelTitle>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-3 bg-inset p-4">
            <ForkVisual isolated={isolated} />
            <p className="font-mono text-2xs text-fg-subtle">
              {isolated
                ? "Each shoot ends in its own checkout node — no two agents touch the same tree."
                : "Every shoot converges on one node — the agents contend for the same files."}
            </p>
          </PanelBody>
        </Panel>

        <Panel className="min-h-[280px]">
          <PanelHeader>
            <PanelTitle icon={<GitFork />}>
              {isolated ? ".git/worktrees layout" : "shared working tree"}
            </PanelTitle>
          </PanelHeader>
          <PanelBody className="bg-inset p-0">
            <CodeBlock
              title={isolated ? ".git/worktrees" : "working tree"}
              code={isolated ? WORKTREE_LAYOUT : SHARED_LAYOUT}
              className="rounded-none border-0"
            />
          </PanelBody>
        </Panel>
      </div>

      <DiffView
        path={diff.path}
        changeType={diff.changeType}
        additions={diff.additions}
        deletions={diff.deletions}
        lines={diff.lines}
        className="mt-4"
        actions={
          <Badge tone={isolated ? "success" : "attention"} dot>
            {isolated ? "clean apply" : "conflict"}
          </Badge>
        }
      />

      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        {isolated
          ? "Grove: each diff applies to its own tree — no shared-file contention."
          : "Shared checkout: two agents race the same lines; one agent's work is overwritten."}
      </p>
    </Section>
  );
}
