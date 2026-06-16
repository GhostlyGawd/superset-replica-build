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
        {isolated ? (
          <Badge tone="success">
            <ShieldCheck aria-hidden className="size-3" /> isolated
          </Badge>
        ) : (
          <Badge tone="attention">
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
          <PanelBody className="bg-inset p-0">
            <CodeBlock
              title=".git/worktrees"
              code={WORKTREE_LAYOUT}
              className="rounded-none border-0"
            />
          </PanelBody>
        </Panel>

        <DiffView
          path={diff.path}
          changeType={diff.changeType}
          additions={diff.additions}
          deletions={diff.deletions}
          lines={diff.lines}
          className="min-h-[280px]"
          actions={
            <Badge tone={isolated ? "success" : "attention"}>
              {isolated ? "clean apply" : "conflict"}
            </Badge>
          }
        />
      </div>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        {isolated
          ? "Grove: each diff applies to its own tree — no shared-file contention."
          : "Shared checkout: two agents race the same lines; one agent's work is overwritten."}
      </p>
    </Section>
  );
}
