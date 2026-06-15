import type { Workspace } from "@swarm/db";
import { Tabs } from "@swarm/ui/react";
import { GitCompare, TerminalSquare } from "lucide-react";
import { useState } from "react";
import type { HostConnection, HostTrpcClient } from "../host-client.ts";
import { DiffPanel } from "./diff/DiffPanel.tsx";
import type { HotkeyBindings } from "./shortcuts/registry.ts";
import { TerminalPanel } from "./terminal/TerminalPanel.tsx";

export interface ContentTabsProps {
  readonly client: HostTrpcClient;
  readonly conn: HostConnection;
  readonly workspace: Workspace;
  /** Host OS — picks the reliably-present default interactive shell. */
  readonly os: string;
  /** Merged hotkey config the terminal keymap reads from (P09). */
  readonly hotkeys: HotkeyBindings;
  /** True while a modal dialog owns the keyboard — suspends the terminal keymap. */
  readonly suspendKeymaps: boolean;
}

/**
 * The content pane's main tabbed surface: Terminal (P05) | Diff (P06) for the
 * selected worktree. The terminal stays mounted across tab switches (its live PTY
 * sessions survive), so it is toggled with `hidden` rather than unmounted.
 */
export function ContentTabs({
  client,
  conn,
  workspace,
  os,
  hotkeys,
  suspendKeymaps,
}: ContentTabsProps) {
  const [tab, setTab] = useState<"terminal" | "diff">("terminal");
  const defaultShell = os === "windows" ? "powershell" : "bash";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        items={[
          { value: "terminal", label: "Terminal", icon: <TerminalSquare /> },
          { value: "diff", label: "Diff", icon: <GitCompare /> },
        ]}
        value={tab}
        onValueChange={(v) => setTab(v as "terminal" | "diff")}
        renderPanel={false}
      />
      <div className="min-h-0 flex-1 pt-3">
        <div className={tab === "terminal" ? "h-full" : "hidden"}>
          <TerminalPanel
            conn={conn}
            workspace={workspace}
            defaultShell={defaultShell}
            visible={tab === "terminal" && !suspendKeymaps}
            hotkeys={hotkeys}
          />
        </div>
        {tab === "diff" ? (
          <div className="h-full">
            <DiffPanel client={client} workspace={workspace} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
