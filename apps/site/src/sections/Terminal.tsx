import { Badge, TerminalFrame } from "@swarm/ui/react";
import { useState } from "react";
import { RecordedTerminal } from "../components/RecordedTerminal";
import { Section } from "../components/Section";
import {
  DEFAULT_TERMINAL_SESSION,
  DEFAULT_TERMINAL_TAB,
  TERMINAL_SESSIONS,
} from "../store/fixtures";

const TABS = [
  { id: "auth-flow", label: "claude · auth-flow" },
  { id: "pty-backpressure", label: "claude · pty-backpressure" },
  { id: "ports", label: "codex · ports" },
];

export function Terminal() {
  const [tab, setTab] = useState(DEFAULT_TERMINAL_TAB);
  const session = TERMINAL_SESSIONS[tab] ?? DEFAULT_TERMINAL_SESSION;

  return (
    <Section
      id="terminal"
      num="03"
      title="The terminal, streamed"
      subhead="Each agent gets a real shell — full PTY, ANSI mapped to the Grove palette. Each tab is a different agent's recorded session: switch tabs and you see that agent's own output. It holds still until you replay it, then plays once and stops. The only thing moving at rest is the cursor."
    >
      <TerminalFrame
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
        shell={session.shell}
        cwd={session.cwd}
        cols={session.cols}
        rows={session.rows}
        connected
        showFind={false}
        actions={
          <Badge tone="neutral" className="mr-1">
            recorded session
          </Badge>
        }
        className="h-[420px]"
      >
        {/* Keyed by tab: switching agents remounts with that agent's distinct
            session (fresh poster-frame), and only the mounted instance answers
            the palette `up` replay. */}
        <RecordedTerminal key={tab} session={session} />
      </TerminalFrame>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        Replay the active tab with the ▶ control, or run <span className="text-fg-muted">up</span>{" "}
        from the command palette (⌘K).
      </p>
    </Section>
  );
}
