import type { Workspace } from "@swarm/db";
import { Badge, EmptyState, IconButton, Spinner, StatusBadge, Tooltip } from "@swarm/ui/react";
import { Code, FolderOpen, Keyboard, LayoutGrid, Terminal, TerminalSquare } from "lucide-react";
import type { ReactNode } from "react";
import { ContentTabs } from "./ContentTabs.tsx";
import type { HotkeyBindings } from "./shortcuts/registry.ts";
import { type HostState, effectiveStatus } from "./useHost.ts";
import type { ExternalTarget } from "./workspace/external.ts";

interface ContentPaneProps {
  readonly host: HostState;
  readonly selected: Workspace | null;
  readonly hotkeys: HotkeyBindings;
  /** True while a modal dialog is open — suspends the terminal keymap. */
  readonly suspendKeymaps: boolean;
  readonly onOpenExternal: (target: ExternalTarget) => void;
  readonly onOpenSettings: () => void;
}

const EXTERNAL_ICONS: Record<ExternalTarget, ReactNode> = {
  editor: <Code />,
  terminal: <Terminal />,
  folder: <FolderOpen />,
};

const EXTERNAL_LABELS: Record<ExternalTarget, string> = {
  editor: "Open in editor",
  terminal: "Open in terminal",
  folder: "Reveal in file manager",
};

/**
 * The main pane: a connection-aware header plus the Terminal (P05) | Diff (P06)
 * tabbed surface for the selected worktree, both wired to the real host (live PTY
 * stream + real git diff). Every non-connected phase renders a real state, not a
 * crash.
 */
export function ContentPane({
  host,
  selected,
  hotkeys,
  suspendKeymaps,
  onOpenExternal,
  onOpenSettings,
}: ContentPaneProps) {
  const { phase, liveStatus, client, conn, info } = host;
  const canOpenExternal = phase === "connected" && selected !== null;

  return (
    <main data-testid="content-pane" className="flex min-w-0 flex-col bg-base">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-2 pl-3">
        {selected ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-fg">{selected.name}</span>
            <Badge tone="neutral">{selected.branch}</Badge>
            <StatusBadge status={effectiveStatus(selected, liveStatus)} />
          </div>
        ) : (
          <span className="text-sm text-fg-subtle">No worktree selected</span>
        )}

        <div className="flex shrink-0 items-center gap-0.5" data-testid="content-actions">
          {(["editor", "terminal", "folder"] as const).map((target) => (
            <Tooltip key={target} label={EXTERNAL_LABELS[target]}>
              <IconButton
                size="sm"
                aria-label={EXTERNAL_LABELS[target]}
                disabled={!canOpenExternal}
                onClick={() => onOpenExternal(target)}
              >
                {EXTERNAL_ICONS[target]}
              </IconButton>
            </Tooltip>
          ))}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <Tooltip label="Keyboard shortcuts">
            <IconButton size="sm" aria-label="Keyboard shortcuts" onClick={onOpenSettings}>
              <Keyboard />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3">
        {phase === "connected" && selected && client && conn ? (
          <ContentTabs
            client={client}
            conn={conn}
            workspace={selected}
            os={info?.os ?? "linux"}
            hotkeys={hotkeys}
            suspendKeymaps={suspendKeymaps}
          />
        ) : (
          <section className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-line bg-inset">
            {phase === "connecting" ? (
              <div className="flex flex-col items-center gap-2 text-fg-muted">
                <Spinner size="lg" label="Connecting to host" />
                <span className="text-xs">Connecting to host…</span>
              </div>
            ) : phase === "connected" ? (
              <EmptyState
                icon={<LayoutGrid />}
                title="Select a worktree"
                description="Pick a worktree from the rail to inspect its terminal and diff."
              />
            ) : (
              <EmptyState
                icon={<TerminalSquare />}
                title="Not connected"
                description="Connect to a running Grove host to load its worktrees."
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}
