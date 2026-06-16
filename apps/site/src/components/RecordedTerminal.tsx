import { useEffect, useRef, useState } from "react";
import { on } from "../lib/bus";
import type { TermLine, TermSession } from "../store/fixtures";

const TONE_CLASS: Record<TermLine["tone"], string> = {
  fg: "text-fg",
  muted: "text-fg-muted",
  subtle: "text-fg-subtle",
  accent: "text-accent-fg",
  running: "text-running-fg",
  success: "text-success-fg",
  error: "text-error-fg",
  attention: "text-attention-fg",
};

/**
 * A recorded terminal session for ONE agent's shell. The poster-frame (every
 * line) is the SSR/default state, so the real output is in the static HTML and
 * on screen at rest. Replay is PULL-ONLY — the ▶ control, or the palette `up`
 * verb — and plays the lines in once, then holds on the final frame. The cursor
 * blink (grove-pulse) is the only ambient motion. Reduced-motion jumps straight
 * to the end state.
 *
 * The body is keyed by the active tab in the section, so switching agents
 * remounts this with that agent's distinct `session` (fresh poster-frame); only
 * the mounted instance listens for the replay bus event, so palette `up` always
 * replays the agent you are looking at.
 */
export function RecordedTerminal({
  session,
  replayable = true,
}: {
  readonly session: TermSession;
  readonly replayable?: boolean;
}) {
  const total = session.lines.length;
  const [shown, setShown] = useState(total);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  const replay = () => {
    clearTimers();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(total);
      return;
    }
    setShown(0);
    for (let i = 1; i <= total; i++) {
      const id = window.setTimeout(() => setShown(i), i * 170);
      timers.current.push(id);
    }
  };

  // Keep a ref to the latest replay so the bus subscription is set up once.
  const replayRef = useRef(replay);
  replayRef.current = replay;

  useEffect(() => {
    if (!replayable) return undefined;
    const off = on((e) => {
      if (e.type === "replay-terminal") replayRef.current();
    });
    return () => {
      off();
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    };
  }, [replayable]);

  const lines = session.lines.slice(0, shown);

  return (
    <div className="flex flex-col">
      {replayable ? (
        <div className="mb-1 flex items-center justify-between">
          <button
            type="button"
            onClick={replay}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2 py-1 font-mono text-2xs text-fg-muted transition-colors duration-fast hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-inset"
            aria-label="Replay the recorded session"
          >
            <span aria-hidden>▶</span> replay
          </button>
        </div>
      ) : null}
      {lines.map((line, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered recorded session
          key={index}
          className={TONE_CLASS[line.tone]}
        >
          {line.text}
        </span>
      ))}
      <span className="text-accent-fg">
        ❯<span className="grove-pulse ml-0.5 inline-block h-3.5 w-2 translate-y-0.5 bg-accent-fg" />
      </span>
    </div>
  );
}
