import type { Workspace } from "@swarm/db";
import { EmptyState, ErrorState, Spinner, TerminalFrame } from "@swarm/ui/react";
import { SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShellFor } from "../host-reads.ts";
import type { HostState } from "../useHost.ts";
import { AccessoryBar } from "./AccessoryBar.tsx";
import { MobileXterm, type MobileXtermHandle, type PaneStatus } from "./MobileXterm.tsx";
import { toControlCode } from "./control-codes.ts";

interface TerminalViewProps {
  readonly host: HostState;
  /** The worktree whose PTY the terminal attaches to (the app's active worktree). */
  readonly workspaceId: string | null;
}

interface Session {
  readonly id: string;
  readonly shell: string;
}

/**
 * Track the soft-keyboard inset via the VisualViewport API so the accessory bar can
 * lift above the keyboard instead of being buried under it. Returns the covered
 * height in px (0 when no keyboard / unsupported). Guarded for environments without
 * `visualViewport` (older browsers, SSR, the headless e2e — where it stays 0).
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    const onResize = (): void => {
      // The portion of the layout viewport the keyboard (and any browser UI) covers.
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(Math.round(covered));
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);
  return inset;
}

/**
 * The phone Terminal tab (W4): a single live xterm pane streaming a REAL host PTY over
 * the `/terminal` WebSocket for the active worktree, plus the touch accessory bar.
 * `terminal.shellFor` picks the worktree's default shell; sessions are switchable (a
 * tab strip) but there are no split panes (those are desktop). The sticky Ctrl
 * modifier and the special/symbol keys all funnel through one send path so a chord
 * armed on the bar applies to the very next soft-keyboard key.
 */
export function TerminalView({ host, workspaceId }: TerminalViewProps) {
  const workspace: Workspace | undefined = host.workspaces.find((ws) => ws.id === workspaceId);
  const shellInfo = useShellFor(host.client, workspaceId);
  const defaultShell = shellInfo.state === "ready" ? shellInfo.value.defaultShell : undefined;

  const idCounter = useRef(0);
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [statuses, setStatuses] = useState<ReadonlyMap<string, PaneStatus>>(new Map());

  const handles = useRef(new Map<string, MobileXtermHandle>());
  const ctrlArmedRef = useRef(false);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const keyboardInset = useKeyboardInset();

  // A fresh worktree (or the shell finally resolving) starts one clean session for
  // that cwd — mirrors the desktop terminal's reset-on-workspace-change.
  useEffect(() => {
    if (!workspaceId || !defaultShell) {
      setSessions([]);
      setActiveId("");
      return;
    }
    const id = `term_${idCounter.current++}`;
    setSessions([{ id, shell: defaultShell }]);
    setActiveId(id);
    setStatuses(new Map());
    ctrlArmedRef.current = false;
    setCtrlArmed(false);
  }, [workspaceId, defaultShell]);

  const setHandle = useCallback((id: string, handle: MobileXtermHandle | null) => {
    if (handle) {
      handles.current.set(id, handle);
    } else {
      handles.current.delete(id);
    }
  }, []);

  const sendRaw = useCallback(
    (data: string) => {
      handles.current.get(activeId)?.send(data);
    },
    [activeId],
  );

  const disarmCtrl = useCallback(() => {
    ctrlArmedRef.current = false;
    setCtrlArmed(false);
  }, []);

  // A printable char: Ctrl-chord it when armed (then disarm), else send verbatim.
  const sendChar = useCallback(
    (ch: string) => {
      if (ctrlArmedRef.current && ch.length === 1) {
        sendRaw(toControlCode(ch));
        disarmCtrl();
      } else {
        sendRaw(ch);
      }
    },
    [sendRaw, disarmCtrl],
  );

  // Local keystrokes from xterm flow through here so the armed Ctrl applies to the
  // next soft-keyboard key exactly as it would on a hardware keyboard.
  const onLocalData = useCallback(
    (data: string) => {
      if (ctrlArmedRef.current && data.length === 1) {
        sendRaw(toControlCode(data));
        disarmCtrl();
      } else {
        sendRaw(data);
      }
    },
    [sendRaw, disarmCtrl],
  );

  // A fixed control sequence (Esc/Tab/arrows/Enter): always verbatim; consumes Ctrl.
  const onSpecial = useCallback(
    (sequence: string) => {
      sendRaw(sequence);
      if (ctrlArmedRef.current) {
        disarmCtrl();
      }
    },
    [sendRaw, disarmCtrl],
  );

  const toggleCtrl = useCallback(() => {
    ctrlArmedRef.current = !ctrlArmedRef.current;
    setCtrlArmed(ctrlArmedRef.current);
    handles.current.get(activeId)?.focus();
  }, [activeId]);

  const newSession = useCallback(() => {
    if (!defaultShell) {
      return;
    }
    const id = `term_${idCounter.current++}`;
    setSessions((prev) => [...prev, { id, shell: defaultShell }]);
    setActiveId(id);
  }, [defaultShell]);

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
    // The newly-visible pane was hidden (zero-size); refit it to the viewport.
    requestAnimationFrame(() => {
      handles.current.get(id)?.fit();
      handles.current.get(id)?.focus();
    });
  }, []);

  const closeSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeId) {
          setActiveId(next[next.length - 1]?.id ?? "");
        }
        return next;
      });
    },
    [activeId],
  );

  const clearActive = useCallback(() => handles.current.get(activeId)?.clear(), [activeId]);

  // Honest pre-conditions: nothing to attach to, or the shell descriptor is loading.
  if (!host.client || !host.conn) {
    return (
      <EmptyState
        icon={<SquareTerminal />}
        title="Not connected"
        description="Pair a host to open a live terminal."
        className="h-full justify-center"
      />
    );
  }
  if (!workspaceId || !workspace) {
    return (
      <EmptyState
        icon={<SquareTerminal />}
        title="No worktree selected"
        description="Pick or create a worktree, then open its terminal here."
        className="h-full justify-center"
      />
    );
  }
  if (shellInfo.state === "loading" || !defaultShell) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner size="lg" label="Preparing the terminal" />
      </div>
    );
  }
  if (shellInfo.state === "error") {
    return (
      <ErrorState
        title="Could not open the terminal"
        description={shellInfo.error}
        className="h-full justify-center"
      />
    );
  }

  const conn = host.conn;
  const frameTabs = sessions.map((s, i) => ({ id: s.id, label: `${s.shell} ${i + 1}` }));
  const activeStatus = statuses.get(activeId);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ paddingBottom: keyboardInset }}>
      <TerminalFrame
        className="min-h-0 flex-1"
        tabs={frameTabs}
        activeTab={activeId}
        onTabChange={selectSession}
        onTabClose={sessions.length > 1 ? closeSession : undefined}
        shell={defaultShell}
        cwd={shellInfo.value.cwd}
        connected={activeStatus === "live"}
        showFind={false}
        showSplit={false}
        onNewTab={newSession}
        onClear={clearActive}
      >
        <div className="relative h-full min-h-0">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={session.id === activeId ? "absolute inset-0" : "hidden"}
            >
              <MobileXterm
                ref={(h) => setHandle(session.id, h)}
                conn={conn}
                workspaceId={workspace.id}
                shell={session.shell}
                active={session.id === activeId}
                onLocalData={onLocalData}
                onStatus={(status) =>
                  setStatuses((prev) => {
                    const next = new Map(prev);
                    next.set(session.id, status);
                    return next;
                  })
                }
              />
            </div>
          ))}
        </div>
      </TerminalFrame>

      <AccessoryBar
        ctrlArmed={ctrlArmed}
        onToggleCtrl={toggleCtrl}
        onSpecial={onSpecial}
        onChar={sendChar}
      />
    </div>
  );
}
