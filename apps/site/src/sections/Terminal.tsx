import { Badge, TerminalFrame } from "@swarm/ui/react";
import { useState } from "react";
import { RecordedTerminal } from "../components/RecordedTerminal";
import { Section } from "../components/Section";

const TABS = [
  { id: "auth-flow", label: "claude · auth-flow" },
  { id: "pty", label: "claude · pty-backpressure" },
  { id: "ports", label: "codex · ports" },
];

export function Terminal() {
  const [tab, setTab] = useState("auth-flow");

  return (
    <Section
      id="terminal"
      num="03"
      title="The terminal, streamed"
      subhead="Each agent gets a real shell — full PTY, ANSI mapped to the Grove palette. Tab between agents, split a pane. This is a recorded session: it holds still until you replay it, then plays once and stops. The only thing moving at rest is the cursor."
    >
      <TerminalFrame
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
        shell="pwsh 7.4"
        cwd=".grove/wt/auth-flow"
        cols={120}
        rows={32}
        connected
        showFind={false}
        actions={
          <Badge tone="neutral" className="mr-1">
            recorded session
          </Badge>
        }
        className="h-[420px]"
      >
        <RecordedTerminal />
      </TerminalFrame>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        Replay with the ▶ control, or run <span className="text-fg-muted">up</span> from the command
        palette (⌘K).
      </p>
    </Section>
  );
}
