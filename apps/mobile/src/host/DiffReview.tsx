import { Button, DiffView, EmptyState, ErrorState, Select, Spinner } from "@swarm/ui/react";
import type { DiffLine } from "@swarm/ui/react";
import { ChevronLeft, ChevronRight, FileDiff, GitCompare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileChange, FileDiff as FileDiffData } from "./host-reads.ts";
import type { HostState } from "./useHost.ts";

interface DiffReviewProps {
  readonly host: HostState;
  /** The worktree under review (the app's active worktree); `null` until one is picked. */
  readonly workspaceId: string | null;
  readonly onSelectWorkspace: (id: string) => void;
}

/** Expand parsed hunks into the gutter-numbered lines the DiffView renders. */
function toDiffLines(diff: FileDiffData): DiffLine[] {
  const out: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    out.push({ type: "hunk", text: hunk.header });
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const raw of hunk.lines) {
      const body = raw.slice(1);
      if (raw.startsWith("+")) {
        out.push({ type: "add", newNumber: newNo++, text: body });
      } else if (raw.startsWith("-")) {
        out.push({ type: "remove", oldNumber: oldNo++, text: body });
      } else {
        out.push({ type: "context", oldNumber: oldNo++, newNumber: newNo++, text: body });
      }
    }
  }
  return out;
}

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly changes: readonly FileChange[] }
  | { readonly kind: "error"; readonly error: string };

/**
 * The Diff tab (W3): pick a worktree, then a READ-ONLY review of its real
 * working-tree-vs-HEAD diff. `diffs.status` lists the changed files (+/- counts);
 * tapping one fetches `diffs.getFileDiff` and renders the hunks with the shared
 * `@swarm/ui` DiffView. Inline edit stays a desktop affordance — the phone reviews,
 * it does not write. Honest loading / empty / error states throughout.
 */
export function DiffReview({ host, workspaceId, onSelectWorkspace }: DiffReviewProps) {
  const { client, workspaces } = host;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiffData | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const reqId = useRef(0);

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  // Load the change set whenever the chosen worktree (or a manual reload) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` is the manual-retry trigger; the body reads only client + workspaceId.
  useEffect(() => {
    if (!client || !workspaceId) {
      return;
    }
    let cancelled = false;
    setPhase({ kind: "loading" });
    setSelectedPath(null);
    setDiff(null);
    void (async () => {
      try {
        const changes = await client.diffs.status.query({ workspaceId });
        if (!cancelled) {
          setPhase({ kind: "ready", changes });
        }
      } catch (err) {
        if (!cancelled) {
          setPhase({ kind: "error", error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, reloads]);

  // Fetch the selected file's diff (read-only); guard against out-of-order responses.
  useEffect(() => {
    if (!client || !workspaceId || !selectedPath) {
      setDiff(null);
      return;
    }
    const mine = ++reqId.current;
    setDiffError(null);
    setDiff(null);
    void (async () => {
      try {
        const file = await client.diffs.getFileDiff.query({ workspaceId, path: selectedPath });
        if (mine === reqId.current) {
          setDiff(file);
        }
      } catch (err) {
        if (mine === reqId.current) {
          setDiffError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
  }, [client, workspaceId, selectedPath]);

  const picker = (
    <Select
      label="Worktree"
      value={workspaceId ?? ""}
      onChange={(event) => onSelectWorkspace(event.target.value)}
      className="h-11"
    >
      {workspaces.map((ws) => (
        <option key={ws.id} value={ws.id}>
          {ws.name} · {ws.branch}
        </option>
      ))}
    </Select>
  );

  if (!workspaceId) {
    return (
      <div className="flex w-full flex-col gap-3 self-start">
        {picker}
        <EmptyState
          icon={<GitCompare />}
          title="Pick a worktree"
          description="Choose a worktree above to review its changes."
        />
      </div>
    );
  }

  // Per-file diff view (read-only) with a back affordance to the change list.
  if (selectedPath) {
    const change =
      phase.kind === "ready" ? phase.changes.find((c) => c.path === selectedPath) : undefined;
    return (
      <div className="flex h-full min-h-0 w-full flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<ChevronLeft className="size-4" />}
          className="min-h-11 self-start"
          onClick={() => setSelectedPath(null)}
        >
          All changes
        </Button>
        {diffError ? (
          <ErrorState title="Could not load file diff" description={diffError} />
        ) : !diff || !change ? (
          <div className="grid flex-1 place-items-center">
            <Spinner size="lg" label="Loading file diff" />
          </div>
        ) : (
          <DiffView
            className="min-h-0 flex-1"
            path={diff.path}
            changeType={change.changeType}
            additions={change.additions}
            deletions={change.deletions}
            lines={toDiffLines(diff)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 self-start">
      {picker}
      {phase.kind === "loading" ? (
        <div className="grid place-items-center py-10">
          <Spinner size="lg" label="Loading changes" />
        </div>
      ) : phase.kind === "error" ? (
        <ErrorState
          title="Could not load changes"
          description={phase.error}
          action={
            <Button size="sm" className="min-h-11" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : phase.changes.length === 0 ? (
        <EmptyState
          icon={<FileDiff />}
          title="No changes in this worktree"
          description="This worktree matches HEAD — there is nothing to review yet."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {phase.changes.map((change) => {
            const name = change.path.split("/").pop() ?? change.path;
            const dir = change.path.slice(0, change.path.length - name.length);
            return (
              <li key={change.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(change.path)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors duration-fast ease-standard hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-xs text-fg">{name}</span>
                    {dir ? (
                      <span className="truncate font-mono text-2xs text-fg-subtle">{dir}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs tabular-nums">
                    <span className="text-diff-add">+{change.additions}</span>
                    <span className="text-diff-remove">-{change.deletions}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
