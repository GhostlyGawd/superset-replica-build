import type { TerminalClientFrame, TerminalServerFrame } from "@swarm/host/daemon";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { type HostConnection, terminalUrl } from "../../host-client.ts";

/** Imperative handle the TerminalPanel drives for the focused pane (clear/find/fit). */
export interface XtermHandle {
  clear(): void;
  focus(): void;
  fit(): void;
  findNext(query: string): void;
  findPrevious(query: string): void;
  clearSearch(): void;
}

export type PaneStatus = "connecting" | "live" | "closed";

export interface XtermViewProps {
  readonly conn: HostConnection;
  readonly workspaceId: string;
  readonly shell?: string;
  /** When set, the host runs this command non-interactively (preset slots). */
  readonly cmd?: string;
  /** True when this is the focused pane (its stream mirror carries the test id). */
  readonly active: boolean;
  readonly onStatus?: (status: PaneStatus) => void;
}

/** Grove dark terminal theme, aligned with design-system §3 tokens. */
const THEME = {
  background: "#0a0f0d",
  foreground: "#d6dbd8",
  cursor: "#7ee3b0",
  selectionBackground: "#1f6f4a55",
} as const;

/**
 * One real PTY session rendered with xterm.js. Streams the host's PTY over the
 * ephemeral `/terminal` WebSocket topic: incoming `data` frames are written to the
 * terminal, local keystrokes are sent back as `data` frames, and viewport changes
 * are fit + reported as `resize` frames. The full received stream is also mirrored
 * into a visually-hidden node (test id on the focused pane) so the byte stream from
 * the real host can be asserted directly.
 */
export const XtermView = forwardRef<XtermHandle, XtermViewProps>(function XtermView(
  { conn, workspaceId, shell, cmd, active, onStatus },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [stream, setStream] = useState("");

  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear(),
    focus: () => termRef.current?.focus(),
    fit: () => fitRef.current?.fit(),
    findNext: (query: string) => searchRef.current?.findNext(query),
    findPrevious: (query: string) => searchRef.current?.findPrevious(query),
    clearSearch: () => searchRef.current?.clearDecorations(),
  }));

  // Mount the terminal + open the WS exactly once per session identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a session is created once; conn/workspaceId/shell/cmd are fixed for its lifetime (the panel remounts via key to start a new one).
  useEffect(() => {
    const container = hostRef.current;
    if (!container) {
      return;
    }
    const term = new Terminal({
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    try {
      fit.fit();
    } catch {
      // container not laid out yet; the ResizeObserver below will fit shortly.
    }

    onStatus?.("connecting");
    const socket = new WebSocket(
      terminalUrl(conn, { workspaceId, shell, cmd, cols: term.cols, rows: term.rows }),
    );

    const sendClient = (frame: TerminalClientFrame): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(frame));
      }
    };

    socket.addEventListener("open", () => {
      onStatus?.("live");
      sendClient({ t: "resize", cols: term.cols, rows: term.rows });
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      let frame: TerminalServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as TerminalServerFrame;
      } catch {
        return;
      }
      if (frame.t === "data") {
        term.write(frame.data);
        setStream((prev) => (prev + frame.data).slice(-8000));
      } else if (frame.t === "exit") {
        term.write(`\r\n\x1b[2m[process exited with code ${frame.exitCode}]\x1b[0m\r\n`);
        onStatus?.("closed");
      } else if (frame.t === "error") {
        term.write(`\r\n\x1b[31m[terminal error: ${frame.message}]\x1b[0m\r\n`);
        onStatus?.("closed");
      }
    });
    socket.addEventListener("close", () => onStatus?.("closed"));
    socket.addEventListener("error", () => onStatus?.("closed"));

    const onInput = term.onData((data) => sendClient({ t: "data", data }));

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        sendClient({ t: "resize", cols: term.cols, rows: term.rows });
      } catch {
        // ignore transient layout-zero observations
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      onInput.dispose();
      socket.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className="absolute inset-0" data-testid="xterm-host" />
      {/* Hidden mirror of the real host byte stream — robust target for the e2e. */}
      <span className="sr-only" data-testid={active ? "terminal-stream" : undefined}>
        {stream}
      </span>
    </div>
  );
});
