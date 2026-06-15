import type { Workspace } from "@swarm/db";
import { ThemeToggle, useToast } from "@swarm/ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContentPane } from "./ContentPane.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { WorkspaceRail } from "./WorkspaceRail.tsx";
import { SettingsDialog } from "./settings/SettingsDialog.tsx";
import { chordFromEvent } from "./shortcuts/chord.ts";
import { useHotkeys } from "./shortcuts/useHotkeys.ts";
import { useHost } from "./useHost.ts";
import { NewWorkspaceDialog } from "./workspace/NewWorkspaceDialog.tsx";
import { OpenProjectDialog } from "./workspace/OpenProjectDialog.tsx";
import type { ExternalTarget } from "./workspace/external.ts";

function GroveMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden focusable="false">
      <title>Grove</title>
      <path
        d="M12 23V13M12 15L6 8.5M12 13.5L12 5M12 15L18 8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="6" cy="8" r="1.8" fill="currentColor" />
      <circle cx="12" cy="4.5" r="1.8" fill="currentColor" />
      <circle cx="18" cy="8" r="1.8" fill="currentColor" />
    </svg>
  );
}

type DialogKind = "new" | "open" | "settings" | null;

/** The desktop operator cockpit: identity bar, workspace rail, content pane,
 *  status bar — all driven by a real, live host connection. */
export function App() {
  const host = useHost();
  const { toast } = useToast();
  const hotkeys = useHotkeys(host.client);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<DialogKind>(null);

  // Keep the selection valid: default to the first worktree, drop it if it vanishes.
  useEffect(() => {
    if (host.phase !== "connected") {
      return;
    }
    setSelectedId((current) => {
      if (current && host.workspaces.some((ws) => ws.id === current)) {
        return current;
      }
      return host.workspaces[0]?.id ?? null;
    });
  }, [host.phase, host.workspaces]);

  const selected = useMemo(
    () => host.workspaces.find((ws) => ws.id === selectedId) ?? null,
    [host.workspaces, selectedId],
  );

  // The project new/quick worktrees are cut in: the selected (or first) one's.
  const projectId = useMemo(
    () => selected?.projectId ?? host.workspaces[0]?.projectId ?? null,
    [selected, host.workspaces],
  );

  /** Move the selection by an offset through the live worktree list (wraps). */
  const selectByOffset = useCallback(
    (delta: number) => {
      const list = host.workspaces;
      if (list.length === 0) {
        return;
      }
      const index = list.findIndex((ws) => ws.id === selectedId);
      const base = index < 0 ? 0 : index;
      const next = list[(base + delta + list.length) % list.length];
      if (next) {
        setSelectedId(next.id);
      }
    },
    [host.workspaces, selectedId],
  );

  const onCreated = useCallback(
    (workspace: Workspace) => {
      setSelectedId(workspace.id);
      host.refresh();
    },
    [host.refresh],
  );

  /** Quick-create: a worktree with a generated name, no dialog (P08). */
  const quickCreate = useCallback(async () => {
    if (!host.client || !projectId) {
      toast({
        tone: "attention",
        title: "No project loaded",
        description: "Open a project before creating worktrees.",
      });
      return;
    }
    const suffix = Date.now().toString(36).slice(-5);
    const name = `quick-${suffix}`;
    try {
      const workspace = await host.client.workspaces.create.mutate({
        projectId,
        name,
        branch: `grove/${name}`,
        baseBranch: "main",
      });
      setSelectedId(workspace.id);
      host.refresh();
      toast({ tone: "success", title: "Worktree created", description: workspace.name });
    } catch (err) {
      toast({
        tone: "error",
        title: "Couldn't create worktree",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [host.client, host.refresh, projectId, toast]);

  /** Open the selected worktree on the host in an external editor/terminal/folder. */
  const openExternal = useCallback(
    async (target: ExternalTarget) => {
      if (!host.client || !selected) {
        return;
      }
      try {
        await host.client.workspaces.openExternal.mutate({ workspaceId: selected.id, target });
      } catch (err) {
        toast({
          tone: "error",
          title: `Couldn't open ${target}`,
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [host.client, selected, toast],
  );

  // App-shell keymap (P09): reads the merged hotkey config and is suspended while
  // a modal dialog is open (the dialog owns the keyboard, incl. capture-to-rebind).
  useEffect(() => {
    if (dialog !== null) {
      return;
    }
    const bindings = hotkeys.bindings;
    const onKey = (event: KeyboardEvent): void => {
      const chord = chordFromEvent(event);
      if (!chord) {
        return;
      }
      const act = (run: () => void): void => {
        event.preventDefault();
        event.stopPropagation();
        run();
      };
      if (chord === bindings["settings.open"]) {
        act(() => setDialog("settings"));
      } else if (chord === bindings["workspace.openProject"]) {
        act(() => setDialog("open"));
      } else if (chord === bindings["workspace.new"]) {
        act(() => setDialog("new"));
      } else if (chord === bindings["workspace.quickCreate"]) {
        act(() => void quickCreate());
      } else if (chord === bindings["workspace.next"]) {
        act(() => selectByOffset(1));
      } else if (chord === bindings["workspace.prev"]) {
        act(() => selectByOffset(-1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog, hotkeys.bindings, quickCreate, selectByOffset]);

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] bg-base text-fg">
      <header
        data-testid="app-titlebar"
        className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3"
      >
        <span className="flex items-center gap-2">
          <GroveMark className="size-5 text-accent-fg" />
          <span className="text-sm font-semibold tracking-tight text-fg">Grove</span>
          <span className="font-mono text-2xs text-fg-subtle">mission control</span>
        </span>
        <ThemeToggle />
      </header>

      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)]">
        <WorkspaceRail
          host={host}
          filter={filter}
          onFilter={setFilter}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onNewWorkspace={() => setDialog("new")}
          onOpenProject={() => setDialog("open")}
          canCreate={projectId !== null}
        />
        <ContentPane
          host={host}
          selected={selected}
          hotkeys={hotkeys.bindings}
          suspendKeymaps={dialog !== null}
          onOpenExternal={(target) => void openExternal(target)}
          onOpenSettings={() => setDialog("settings")}
        />
      </div>

      <StatusBar host={host} />

      {/* Dialogs are mounted only while active: a `@swarm/ui` Dialog renders a
          closed `<dialog>` visibly, so an always-mounted one would pollute the
          page (intercept clicks, duplicate accessible names). */}
      {dialog === "new" ? (
        <NewWorkspaceDialog
          open
          onOpenChange={(next) => setDialog(next ? "new" : null)}
          client={host.client}
          projectId={projectId}
          onCreated={onCreated}
        />
      ) : null}
      {dialog === "open" ? (
        <OpenProjectDialog
          open
          onOpenChange={(next) => setDialog(next ? "open" : null)}
          client={host.client}
          onOpened={onCreated}
        />
      ) : null}
      {dialog === "settings" ? (
        <SettingsDialog
          open
          onOpenChange={(next) => setDialog(next ? "settings" : null)}
          controller={hotkeys}
        />
      ) : null}
    </div>
  );
}
