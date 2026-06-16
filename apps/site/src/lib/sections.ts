/**
 * The page's panes, in scroll order. Both the command palette and the
 * status-strip chevron navigate by these ids; section components mount the
 * matching `id` so focus/scroll targets are real DOM anchors.
 */
export interface SectionDef {
  readonly id: string;
  readonly num: string;
  readonly title: string;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: "cold-open", num: "00", title: "Live roster" },
  { id: "swarm-dial", num: "01", title: "The swarm dial" },
  { id: "isolation", num: "02", title: "Worktree isolation" },
  { id: "terminal", num: "03", title: "The terminal" },
  { id: "harvest", num: "04", title: "Diff review & harvest" },
  { id: "monitoring", num: "05", title: "Monitoring & attention" },
  { id: "phone", num: "06", title: "Phone pairing" },
  { id: "install", num: "07", title: "Install" },
];

/** A command-palette verb — the real product CLI surface, mapped to a pane. */
export interface PaletteVerb {
  readonly verb: string;
  readonly hint: string;
  /** Section id to scroll/focus. */
  readonly target: string;
}

export const VERBS: readonly PaletteVerb[] = [
  { verb: "up", hint: "start the swarm · replay the terminal", target: "terminal" },
  { verb: "ls", hint: "list the live roster", target: "cold-open" },
  { verb: "diff", hint: "review changes", target: "harvest" },
  { verb: "status", hint: "monitoring & attention board", target: "monitoring" },
  { verb: "harvest", hint: "stage a reviewed worktree → main", target: "harvest" },
  { verb: "pair", hint: "pair the phone over loopback", target: "phone" },
  { verb: "kill", hint: "worktree isolation — no collisions", target: "isolation" },
];

/** Smooth-scroll a pane into view and move focus to it (keyboard-honest). */
export function focusSection(id: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // Make the pane programmatically focusable for screen-reader + keyboard users.
  el.setAttribute("tabindex", "-1");
  (el as HTMLElement).focus({ preventScroll: true });
}
