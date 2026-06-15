import type { Workspace } from "@swarm/db";
import { EmptyState, IconButton, TerminalFrame, Tooltip } from "@swarm/ui/react";
import { ChevronDown, ChevronUp, TerminalSquare, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostConnection } from "../../host-client.ts";
import { type XtermHandle, XtermView } from "./XtermView.tsx";
import { DEFAULT_PRESETS, presetForSlot } from "./presets.ts";

interface Pane {
  readonly id: string;
  /** Shell kind for the session. */
  readonly shell?: string;
  /** A one-shot command (preset); absent for an interactive shell. */
  readonly cmd?: string;
}

interface TermTab {
  readonly id: string;
  readonly title: string;
  readonly layout: "single" | "right" | "down";
  readonly panes: readonly Pane[];
}

export interface TerminalPanelProps {
  readonly conn: HostConnection;
  readonly workspace: Workspace;
  /** The host's default shell for a fresh interactive session. */
  readonly defaultShell: string;
  /** True when the Terminal tab is the visible content-pane tab (gates the keymap). */
  readonly visible: boolean;
}

/**
 * The built-in terminal (P05): xterm panes inside the `@swarm/ui` TerminalFrame
 * chrome, each streaming a REAL host PTY over the `/terminal` topic. Supports tabs,
 * split right/down, clear, find (search addon), preset slots (Ctrl+1–9), and
 * prev/next tab — keyed to the design-system Windows shortcuts.
 */
export function TerminalPanel({ conn, workspace, defaultShell, visible }: TerminalPanelProps) {
  const idCounter = useRef(0);
  const nextId = useCallback((prefix: string) => `${prefix}_${idCounter.current++}`, []);

  const newShellTab = useCallback((): TermTab => {
    const paneId = `pane_${idCounter.current++}`;
    const tabId = `tab_${idCounter.current++}`;
    return {
      id: tabId,
      title: defaultShell,
      layout: "single",
      panes: [{ id: paneId, shell: defaultShell }],
    };
  }, [defaultShell]);

  const [tabs, setTabs] = useState<readonly TermTab[]>(() => [newShellTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id ?? "");
  const [activePaneId, setActivePaneId] = useState<string>(() => tabs[0]?.panes[0]?.id ?? "");
  const [find, setFind] = useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const [statuses, setStatuses] = useState<ReadonlyMap<string, string>>(new Map());

  const handles = useRef(new Map<string, XtermHandle>());
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // A fresh worktree selection starts a clean terminal session set for that cwd.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is intentionally keyed on the selected workspace only.
  useEffect(() => {
    const tab = newShellTab();
    setTabs([tab]);
    setActiveTabId(tab.id);
    setActivePaneId(tab.panes[0]?.id ?? "");
    setFind({ open: false, query: "" });
  }, [workspace.id]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );

  const openTab = useCallback((tab: TermTab) => {
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setActivePaneId(tab.panes[0]?.id ?? "");
  }, []);

  const newTab = useCallback(() => openTab(newShellTab()), [openTab, newShellTab]);

  const runPreset = useCallback(
    (slot: number) => {
      const preset = presetForSlot(slot);
      if (!preset) {
        return;
      }
      const paneId = nextId("pane");
      openTab({
        id: nextId("tab"),
        title: preset.label,
        layout: "single",
        panes: [{ id: paneId, shell: defaultShell, cmd: preset.command }],
      });
    },
    [openTab, nextId, defaultShell],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          return prev;
        }
        const next = prev.filter((t) => t.id !== id);
        const fallback = next.length === 0 ? [newShellTab()] : next;
        if (id === activeTabId) {
          const neighbour = fallback[Math.min(idx, fallback.length - 1)];
          if (neighbour) {
            setActiveTabId(neighbour.id);
            setActivePaneId(neighbour.panes[0]?.id ?? "");
          }
        }
        return fallback;
      });
    },
    [activeTabId, newShellTab],
  );

  const split = useCallback(
    (layout: "right" | "down") => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId || t.panes.length >= 2) {
            return t;
          }
          return { ...t, layout, panes: [...t.panes, { id: `pane_${idCounter.current++}` }] };
        }),
      );
    },
    [activeTabId],
  );

  const clearActive = useCallback(() => handles.current.get(activePaneId)?.clear(), [activePaneId]);

  const toggleFind = useCallback(() => {
    setFind((f) => {
      const open = !f.open;
      if (open) {
        requestAnimationFrame(() => findInputRef.current?.focus());
      } else {
        handles.current.get(activePaneId)?.clearSearch();
      }
      return { ...f, open };
    });
  }, [activePaneId]);

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTabs((prev) => {
        if (prev.length === 0) {
          return prev;
        }
        const idx = prev.findIndex((t) => t.id === activeTabId);
        const nextIdx = (idx + dir + prev.length) % prev.length;
        const next = prev[nextIdx];
        if (next) {
          setActiveTabId(next.id);
          setActivePaneId(next.panes[0]?.id ?? "");
        }
        return prev;
      });
    },
    [activeTabId],
  );

  // Global keymap (capture phase so xterm doesn't swallow the chords) using the
  // design-system Windows bindings (docs/recon.md Windows column, P05).
  useEffect(() => {
    if (!visible) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) {
        return;
      }
      const handled = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.code === "Tab") {
        handled();
        cycleTab(e.shiftKey ? -1 : 1); // Ctrl+Shift+Tab / Ctrl+Tab
        return;
      }
      if (!e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        handled();
        runPreset(Number(e.code.slice(5))); // Ctrl+1..9
        return;
      }
      if (e.shiftKey && !e.altKey && e.code === "KeyT") {
        handled();
        newTab();
      } else if (e.shiftKey && !e.altKey && e.code === "KeyK") {
        handled();
        clearActive();
      } else if (e.shiftKey && !e.altKey && e.code === "KeyF") {
        handled();
        toggleFind();
      } else if (e.shiftKey && e.altKey && e.code === "KeyD") {
        handled();
        split("down"); // Ctrl+Shift+Alt+D
      } else if (e.shiftKey && !e.altKey && e.code === "KeyD") {
        handled();
        split("right"); // Ctrl+Shift+D
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, cycleTab, runPreset, newTab, clearActive, toggleFind, split]);

  const setHandle = useCallback((paneId: string, handle: XtermHandle | null) => {
    if (handle) {
      handles.current.set(paneId, handle);
    } else {
      handles.current.delete(paneId);
    }
  }, []);

  const runFind = (dir: 1 | -1) => {
    const handle = handles.current.get(activePaneId);
    if (!handle || find.query.length === 0) {
      return;
    }
    if (dir === 1) {
      handle.findNext(find.query);
    } else {
      handle.findPrevious(find.query);
    }
  };

  const frameTabs = tabs.map((t) => ({ id: t.id, label: t.title }));
  const activeStatus = statuses.get(activePaneId);

  const presetBar = (
    <span className="mr-1 flex items-center gap-0.5 border-r border-line pr-1.5">
      {DEFAULT_PRESETS.map((preset) => (
        <Tooltip
          key={preset.slot}
          label={`${preset.label} · Ctrl+${preset.slot} · ${preset.command}`}
        >
          <button
            type="button"
            aria-label={`Run preset ${preset.slot}: ${preset.label}`}
            onClick={() => runPreset(preset.slot)}
            className="inline-flex size-6 items-center justify-center rounded font-mono text-2xs text-fg-muted hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {preset.slot}
          </button>
        </Tooltip>
      ))}
    </span>
  );

  return (
    <TerminalFrame
      className="h-full"
      tabs={frameTabs}
      activeTab={activeTab?.id}
      onTabChange={(id) => {
        setActiveTabId(id);
        const tab = tabs.find((t) => t.id === id);
        setActivePaneId(tab?.panes[0]?.id ?? "");
      }}
      onTabClose={closeTab}
      shell={defaultShell}
      cwd={workspace.worktreePath}
      connected={activeStatus !== "closed"}
      onNewTab={newTab}
      onClear={clearActive}
      onFind={toggleFind}
      onSplitRight={() => split("right")}
      onSplitDown={() => split("down")}
      actions={presetBar}
    >
      <div className="relative h-full min-h-0">
        {find.open ? (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 shadow-md">
            <input
              ref={findInputRef}
              value={find.query}
              onChange={(e) => setFind((f) => ({ ...f, query: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  runFind(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  toggleFind();
                }
              }}
              aria-label="Find in terminal"
              className="h-6 w-40 rounded bg-inset px-2 font-mono text-2xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <IconButton aria-label="Find previous" size="sm" onClick={() => runFind(-1)}>
              <ChevronUp />
            </IconButton>
            <IconButton aria-label="Find next" size="sm" onClick={() => runFind(1)}>
              <ChevronDown />
            </IconButton>
            <IconButton aria-label="Close find" size="sm" onClick={toggleFind}>
              <X />
            </IconButton>
          </div>
        ) : null}

        {activeTab ? (
          <div
            key={activeTab.id}
            className={
              activeTab.layout === "down"
                ? "flex h-full min-h-0 flex-col gap-1"
                : "flex h-full min-h-0 flex-row gap-1"
            }
          >
            {activeTab.panes.map((pane) => (
              <div
                key={pane.id}
                onMouseDown={() => setActivePaneId(pane.id)}
                className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded border ${
                  pane.id === activePaneId && activeTab.panes.length > 1
                    ? "border-accent"
                    : "border-transparent"
                }`}
              >
                <XtermView
                  ref={(h) => setHandle(pane.id, h)}
                  conn={conn}
                  workspaceId={workspace.id}
                  shell={pane.shell}
                  cmd={pane.cmd}
                  active={pane.id === activePaneId}
                  onStatus={(status) =>
                    setStatuses((prev) => {
                      const next = new Map(prev);
                      next.set(pane.id, status);
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<TerminalSquare />}
            title="No terminal"
            description="Press Ctrl+1 or the + button to open a session."
          />
        )}
      </div>
    </TerminalFrame>
  );
}
