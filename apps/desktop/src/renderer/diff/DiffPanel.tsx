import type { Workspace } from "@swarm/db";
import {
  Badge,
  Button,
  DiffView,
  EmptyState,
  ErrorState,
  IconButton,
  Spinner,
} from "@swarm/ui/react";
import type { DiffLine } from "@swarm/ui/react";
import { FilePen, GitCompare, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostTrpcClient } from "../../host-client.ts";

// Derive the wire shapes from the tRPC client so the Node-only @swarm/git-worktree
// package is never imported into the browser renderer (types are erased at build).
type FileChange = Awaited<ReturnType<HostTrpcClient["diffs"]["status"]["query"]>>[number];
type FileDiff = Awaited<ReturnType<HostTrpcClient["diffs"]["getFileDiff"]["query"]>>;

export interface DiffPanelProps {
  readonly client: HostTrpcClient;
  readonly workspace: Workspace;
}

/** Expand parsed hunks into the gutter-numbered lines the DiffView renders. */
function toDiffLines(diff: FileDiff): DiffLine[] {
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

/**
 * Diff viewer + inline editor (P06). Fetches the selected workspace's REAL git diff
 * (working tree vs HEAD) from the host's `diffs` router, lists the changed files,
 * and renders the picked file with `@swarm/ui` DiffView. The file can be edited in
 * place and saved straight back to the worktree via `diffs.writeFile` (a real file
 * write), after which the diff + change list refresh.
 */
export function DiffPanel({ client, workspace }: DiffPanelProps) {
  const [changes, setChanges] = useState<readonly FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const reqId = useRef(0);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const list = await client.diffs.status.query({ workspaceId: workspace.id });
      setChanges(list);
      setSelectedPath((current) => current ?? list[0]?.path ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setChanges([]);
    }
  }, [client, workspace.id]);

  // Reload the change set whenever the selected workspace changes.
  useEffect(() => {
    setChanges(null);
    setSelectedPath(null);
    setDiff(null);
    setEditing(false);
    void loadStatus();
  }, [loadStatus]);

  // Fetch the selected file's diff; seed the editor draft from the on-disk text.
  useEffect(() => {
    if (!selectedPath) {
      setDiff(null);
      return;
    }
    const mine = ++reqId.current;
    setDiffError(null);
    setEditing(false);
    void (async () => {
      try {
        const file = await client.diffs.getFileDiff.query({
          workspaceId: workspace.id,
          path: selectedPath,
        });
        if (mine === reqId.current) {
          setDiff(file);
          setDraft(file.newText);
        }
      } catch (err) {
        if (mine === reqId.current) {
          setDiffError(err instanceof Error ? err.message : String(err));
          setDiff(null);
        }
      }
    })();
  }, [client, workspace.id, selectedPath]);

  const selectedChange = useMemo(
    () => changes?.find((c) => c.path === selectedPath) ?? null,
    [changes, selectedPath],
  );

  const lines = useMemo(() => (diff ? toDiffLines(diff) : []), [diff]);

  const save = useCallback(async () => {
    if (!selectedPath) {
      return;
    }
    setSaving(true);
    try {
      await client.diffs.writeFile.mutate({
        workspaceId: workspace.id,
        path: selectedPath,
        content: draft,
      });
      setEditing(false);
      await loadStatus();
      // Re-fetch the just-saved file's diff so the viewer reflects the new state.
      const file = await client.diffs.getFileDiff.query({
        workspaceId: workspace.id,
        path: selectedPath,
      });
      setDiff(file);
      setDraft(file.newText);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [client, workspace.id, selectedPath, draft, loadStatus]);

  const discard = useCallback(async () => {
    if (!selectedPath) {
      return;
    }
    try {
      await client.diffs.discard.mutate({ workspaceId: workspace.id, path: selectedPath });
      await loadStatus();
      setSelectedPath(null);
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    }
  }, [client, workspace.id, selectedPath, loadStatus]);

  if (changes === null) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="diff-loading">
        <Spinner size="lg" label="Loading diff" />
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Could not load changes"
        description={error}
        action={
          <Button size="sm" onClick={() => void loadStatus()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (changes.length === 0) {
    return (
      <EmptyState
        icon={<GitCompare />}
        title="No changes"
        description="This worktree matches HEAD — nothing to diff yet."
      />
    );
  }

  return (
    <div
      className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)] gap-2"
      data-testid="diff-panel"
    >
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <header className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3 text-xs font-semibold text-fg">
          <span>
            Changes <span className="text-fg-subtle">({changes.length})</span>
          </span>
          <IconButton aria-label="Refresh changes" size="sm" onClick={() => void loadStatus()}>
            <RefreshCw />
          </IconButton>
        </header>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {changes.map((change) => {
            const name = change.path.split("/").pop() ?? change.path;
            const selected = change.path === selectedPath;
            return (
              <li key={change.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(change.path)}
                  title={change.path}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left font-mono text-2xs ${
                    selected ? "bg-inset text-fg" : "text-fg-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  <span className="truncate">{name}</span>
                  <span className="flex shrink-0 items-center gap-1 tabular-nums">
                    <span className="text-diff-add">+{change.additions}</span>
                    <span className="text-diff-remove">-{change.deletions}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col">
        {diffError ? (
          <ErrorState title="Could not load file diff" description={diffError} />
        ) : !diff || !selectedChange ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" label="Loading file diff" />
          </div>
        ) : editing ? (
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
              <span className="truncate font-mono text-xs text-fg">{diff.path}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone="attention">editing</Badge>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Save className="size-3.5" />}
                  onClick={() => void save()}
                  loading={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <IconButton
                  aria-label="Cancel edit"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setDraft(diff.newText);
                  }}
                >
                  <X />
                </IconButton>
              </div>
            </header>
            <textarea
              data-testid="diff-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-inset p-3 font-mono text-xs leading-relaxed text-fg outline-none"
            />
          </div>
        ) : (
          <DiffView
            className="h-full"
            path={diff.path}
            changeType={selectedChange.changeType}
            additions={selectedChange.additions}
            deletions={selectedChange.deletions}
            lines={lines}
            actions={
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FilePen className="size-3.5" />}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                <IconButton
                  aria-label="Discard changes to file"
                  size="sm"
                  onClick={() => void discard()}
                >
                  <RotateCcw />
                </IconButton>
              </div>
            }
          />
        )}
      </section>
    </div>
  );
}
