import { Eraser, Plus, Search, SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../cn";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";

export interface TerminalTab {
  readonly id: string;
  readonly label: string;
}

export interface TerminalFrameProps {
  readonly tabs?: readonly TerminalTab[];
  readonly activeTab?: string;
  readonly onTabChange?: (id: string) => void;
  /** Close a tab (renders a per-tab × affordance when provided). */
  readonly onTabClose?: (id: string) => void;
  /** Shell descriptor shown in the footer, e.g. "pwsh". */
  readonly shell?: string;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly connected?: boolean;
  /**
   * Show the Find-in-terminal toolbar button. Default `true` (desktop + showcase).
   * The phone terminal has no find, so it passes `false` to drop the inert button.
   */
  readonly showFind?: boolean;
  /**
   * Show the split-pane toolbar buttons (split right, and split down when its
   * handler is given). Default `true` (desktop + showcase). The phone terminal is
   * a single pane with no splits, so it passes `false` to drop the inert buttons.
   */
  readonly showSplit?: boolean;
  /** Toolbar handlers — when omitted the buttons stay decorative (showcase). */
  readonly onNewTab?: () => void;
  readonly onClear?: () => void;
  readonly onFind?: () => void;
  readonly onSplitRight?: () => void;
  readonly onSplitDown?: () => void;
  /** Extra toolbar actions appended after the defaults. */
  readonly actions?: ReactNode;
  /** The terminal body (xterm mount, or sample output in the showcase). */
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Baseline chrome for a terminal surface: a session tab strip, toolbar actions,
 * a recessed monospace body well, and a status footer (shell · cwd · geometry ·
 * connection). The PTY/xterm canvas mounts into the body via `children`.
 */
export function TerminalFrame({
  tabs = [],
  activeTab,
  onTabChange,
  onTabClose,
  shell = "pwsh",
  cwd = "~",
  cols = 120,
  rows = 32,
  connected = true,
  showFind = true,
  showSplit = true,
  onNewTab,
  onClear,
  onFind,
  onSplitRight,
  onSplitDown,
  actions,
  children,
  className,
}: TerminalFrameProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-1.5 pr-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab;
            return (
              <span
                key={tab.id}
                className={cn(
                  "group inline-flex h-7 shrink-0 items-center rounded-md font-mono text-xs transition-colors duration-fast",
                  selected ? "bg-inset text-fg" : "text-fg-muted hover:bg-raised hover:text-fg",
                )}
              >
                <button
                  type="button"
                  onClick={() => onTabChange?.(tab.id)}
                  aria-current={selected ? "true" : undefined}
                  className="inline-flex h-7 items-center rounded-md pl-2.5 pr-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                >
                  {tab.label}
                </button>
                {onTabClose ? (
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    onClick={() => onTabClose(tab.id)}
                    className="mr-1 inline-flex size-4 items-center justify-center rounded text-fg-subtle opacity-0 transition-opacity hover:bg-line hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-3"
                  >
                    <X />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          {showFind ? (
            <Tooltip label="Find (Ctrl+Shift+F)">
              <IconButton aria-label="Find in terminal" size="sm" onClick={onFind}>
                <Search />
              </IconButton>
            </Tooltip>
          ) : null}
          <Tooltip label="Clear (Ctrl+Shift+K)">
            <IconButton aria-label="Clear terminal" size="sm" onClick={onClear}>
              <Eraser />
            </IconButton>
          </Tooltip>
          {showSplit ? (
            <Tooltip label="Split right (Ctrl+Shift+D)">
              <IconButton aria-label="Split terminal right" size="sm" onClick={onSplitRight}>
                <SplitSquareHorizontal />
              </IconButton>
            </Tooltip>
          ) : null}
          {showSplit && onSplitDown ? (
            <Tooltip label="Split down (Ctrl+Shift+Alt+D)">
              <IconButton aria-label="Split terminal down" size="sm" onClick={onSplitDown}>
                <SplitSquareVertical />
              </IconButton>
            </Tooltip>
          ) : null}
          <Tooltip label="New tab (Ctrl+Shift+T)">
            <IconButton aria-label="New terminal tab" size="sm" onClick={onNewTab}>
              <Plus />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-inset p-3 font-mono text-xs leading-relaxed text-fg">
        {children}
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-line px-3 font-mono text-2xs text-fg-subtle">
        <span className="truncate">
          <span className="text-fg-muted">{shell}</span> · {cwd}
        </span>
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span>
            {cols}×{rows}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              role="img"
              aria-label={connected ? "Connected to host" : "Disconnected"}
              className={cn("size-1.5 rounded-full", connected ? "bg-success" : "bg-idle")}
            />
            {connected ? "live" : "offline"}
          </span>
        </span>
      </div>
    </div>
  );
}
