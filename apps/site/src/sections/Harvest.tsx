import {
  Button,
  DiffView,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  PanelTitle,
  StatusBadge,
  useToast,
} from "@swarm/ui/react";
import { GitPullRequestArrow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Section } from "../components/Section";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { on } from "../lib/bus";
import { useAgents, useDispatch } from "../store/cockpit";
import { HARVEST_DIFF } from "../store/fixtures";

const TARGET = "auth-flow";

type DiffMode = "split" | "unified";

export function Harvest() {
  const agents = useAgents();
  const dispatch = useDispatch();
  const { toast } = useToast();
  const [mode, setMode] = useState<DiffMode>("unified");
  const target = agents.find((a) => a.id === TARGET);
  const harvested = target?.status === "done";

  const doHarvest = () => {
    if (!target || harvested) return;
    dispatch({ type: "harvest", id: TARGET });
    toast({
      tone: "success",
      title: `Harvested ${target.branch} → main`,
      description: `Worktree ${target.worktree} retired. The rail row is now done.`,
    });
  };

  // The palette `harvest` verb stages this same reviewed worktree (pull-only).
  const harvestRef = useRef(doHarvest);
  harvestRef.current = doHarvest;
  useEffect(() => on((e) => e.type === "stage-harvest" && harvestRef.current()), []);

  return (
    <Section
      id="harvest"
      num="04"
      title="Review the diff, harvest the work"
      subhead="When an agent finishes, you review its diff like a commit and stage exactly that one worktree onto main. Harvest is deliberate and scoped: it stages one reviewed tree, retires it, and leaves every other agent — including the ones that need attention — untouched."
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedToggle
          ariaLabel="Diff layout"
          options={[
            { value: "unified", label: "unified" },
            { value: "split", label: "split" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <span className="font-mono text-2xs text-fg-subtle">
          {mode === "split" ? "side-by-side" : "inline"} · amend one line before staging
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-h-[300px] flex-col gap-2">
          {mode === "unified" ? (
            <DiffView
              path={HARVEST_DIFF.path}
              changeType={HARVEST_DIFF.changeType}
              additions={HARVEST_DIFF.additions}
              deletions={HARVEST_DIFF.deletions}
              lines={HARVEST_DIFF.lines}
              className="min-h-0 flex-1"
            />
          ) : (
            <SplitDiff />
          )}
          <AmendLine />
        </div>

        <Panel className="min-h-[300px]">
          <PanelHeader>
            <PanelTitle icon={<GitPullRequestArrow />}>Run summary</PanelTitle>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-3">
            <dl className="flex flex-col gap-2 text-xs">
              <Row label="agent">{target?.agent ?? "—"}</Row>
              <Row label="branch">
                <span className="font-mono text-fg">{target?.branch}</span>
              </Row>
              <Row label="worktree">
                <span className="font-mono text-fg-muted">{target?.worktree}</span>
              </Row>
              <Row label="changes">
                <span className="font-mono tabular-nums">
                  <span className="text-diff-add">+{HARVEST_DIFF.additions}</span>{" "}
                  <span className="text-diff-remove">-{HARVEST_DIFF.deletions}</span> · 1 file
                </span>
              </Row>
              <Row label="status">{target ? <StatusBadge status={target.status} /> : null}</Row>
            </dl>
            <p className="rounded-md border border-line-subtle bg-inset px-2.5 py-2 font-mono text-2xs text-fg-muted">
              perf/diff: skip offscreen hunks with content-visibility so a 4k-line diff scrolls at
              60fps.
            </p>
          </PanelBody>
          <PanelFooter>
            <span className="font-mono text-2xs text-fg-subtle">
              {harvested ? "staged → main" : "reviewed · ready"}
            </span>
            <Button
              variant="primary"
              icon={<GitPullRequestArrow className="size-3.5" />}
              disabled={harvested}
              onClick={doHarvest}
            >
              {harvested ? "Harvested" : "Harvest → main"}
            </Button>
          </PanelFooter>
        </Panel>
      </div>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        Harvest flips this agent's row in the left rail to done-green and prints the result on the
        status strip — one reviewed worktree, never a fleet auto-merging.
      </p>
    </Section>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-subtle pb-2 last:border-0">
      <dt className="font-mono text-2xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg">{children}</dd>
    </div>
  );
}

/**
 * A real side-by-side diff for the `split` toggle: left = the old file (context
 * + removed lines), right = the new file (context + added lines), sharing the
 * same chrome and gutters as the unified DiffView. Honest — it is the same
 * fixture, just laid out as two columns.
 */
function SplitDiff() {
  const segs = HARVEST_DIFF.path.split("/");
  const file = segs[segs.length - 1];
  const dir = segs.slice(0, -1).join("/");
  const left = HARVEST_DIFF.lines.filter((l) => l.type === "context" || l.type === "remove");
  const right = HARVEST_DIFF.lines.filter((l) => l.type === "context" || l.type === "add");

  const column = (lines: typeof HARVEST_DIFF.lines, side: "old" | "new") => (
    <div
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable so it can be scrolled by keyboard
      tabIndex={0}
      aria-label={side === "old" ? "Diff, old file" : "Diff, new file"}
      className="min-w-0 flex-1 overflow-auto bg-inset font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
    >
      {lines.map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered diff snapshot
          key={i}
          className={
            line.type === "add"
              ? "bg-diff-add-bg"
              : line.type === "remove"
                ? "bg-diff-remove-bg"
                : ""
          }
        >
          <span className="grid grid-cols-[3rem_1fr]">
            <span className="select-none px-2 text-right tabular-nums text-fg-subtle">
              {side === "old" ? (line.oldNumber ?? "") : (line.newNumber ?? "")}
            </span>
            <code className="whitespace-pre px-2 text-fg">
              <span
                className={
                  line.type === "add"
                    ? "select-none text-diff-add"
                    : line.type === "remove"
                      ? "select-none text-diff-remove"
                      : "select-none text-fg-subtle"
                }
              >
                {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
              </span>
              {line.text}
            </code>
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
          {dir ? <span className="truncate text-fg-subtle">{dir}/</span> : null}
          <span className="shrink-0 font-medium text-fg">{file}</span>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-2xs tabular-nums">
          <span className="text-diff-add">+{HARVEST_DIFF.additions}</span>
          <span className="text-diff-remove">-{HARVEST_DIFF.deletions}</span>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 divide-x divide-line">
        {column(left, "old")}
        {column(right, "new")}
      </div>
    </div>
  );
}

/**
 * An honest single-line amend: a constrained contenteditable, not an embedded
 * editor. It lets you tweak the comment on one added line before harvesting —
 * the real, modest affordance, not a fake IDE. Enter and newlines are blocked
 * so it stays exactly one line.
 */
function AmendLine() {
  const blockNewline = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") e.preventDefault();
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-inset px-2.5 py-1.5">
      <span className="shrink-0 font-mono text-2xs text-fg-subtle">amend</span>
      <span className="shrink-0 select-none font-mono text-xs text-diff-add">+ 94</span>
      {/* biome-ignore lint/a11y/useSemanticElements: a single-line contenteditable IS the honest amend affordance (not an <input>); role=textbox is the documented ARIA for it */}
      <span
        role="textbox"
        aria-label="Amend line 94"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onKeyDown={blockNewline}
        className="min-w-0 flex-1 whitespace-nowrap font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-inset"
      >
        {"// content-visibility: skip offscreen hunks"}
      </span>
    </div>
  );
}
