/**
 * The single source-of-truth keyboard-shortcut registry (P09): id → default chord
 * → description, used by BOTH the App shell keymap and the TerminalPanel keymap.
 * The renderer loads the user's persisted overrides on mount (host `settings`
 * router) and merges them over these defaults; every keymap reads the merged
 * config, and the Settings dialog rebinds/resets against the same ids.
 *
 * Modifier order is canonical (`Ctrl`, `Alt`, `Shift`, `Meta`) so a default
 * literal compares equal to {@link chordFromEvent} output. Shell chords use
 * `Ctrl+Alt+…` / `Ctrl+,` and terminal chords use `Ctrl+Shift+…` so the two
 * surfaces never collide.
 */

export type HotkeyScope = "shell" | "terminal";

export interface HotkeyAction {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: HotkeyScope;
  /** Canonical default chord (see {@link chordFromEvent}). */
  readonly defaultChord: string;
}

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  // ── App shell ────────────────────────────────────────────────────────────
  {
    id: "workspace.prev",
    label: "Previous worktree",
    description: "Select the previous worktree in the rail.",
    scope: "shell",
    defaultChord: "Ctrl+Alt+ArrowUp",
  },
  {
    id: "workspace.next",
    label: "Next worktree",
    description: "Select the next worktree in the rail.",
    scope: "shell",
    defaultChord: "Ctrl+Alt+ArrowDown",
  },
  {
    id: "workspace.quickCreate",
    label: "Quick-create worktree",
    description: "Create a worktree immediately with a generated name.",
    scope: "shell",
    defaultChord: "Ctrl+Alt+KeyN",
  },
  {
    id: "workspace.new",
    label: "New worktree…",
    description: "Open the new-worktree dialog (name + base branch).",
    scope: "shell",
    defaultChord: "Ctrl+Alt+Shift+KeyN",
  },
  {
    id: "workspace.openProject",
    label: "Open project…",
    description: "Open an existing git repository on the host as a project.",
    scope: "shell",
    defaultChord: "Ctrl+Alt+KeyO",
  },
  {
    id: "settings.open",
    label: "Keyboard shortcuts…",
    description: "Open the settings dialog to customize shortcuts.",
    scope: "shell",
    defaultChord: "Ctrl+Comma",
  },
  // ── Terminal (P05) ───────────────────────────────────────────────────────
  {
    id: "terminal.newTab",
    label: "New terminal tab",
    description: "Open a fresh interactive shell tab.",
    scope: "terminal",
    defaultChord: "Ctrl+Shift+KeyT",
  },
  {
    id: "terminal.clear",
    label: "Clear terminal",
    description: "Clear the active terminal pane.",
    scope: "terminal",
    defaultChord: "Ctrl+Shift+KeyK",
  },
  {
    id: "terminal.find",
    label: "Find in terminal",
    description: "Toggle the in-terminal search box.",
    scope: "terminal",
    defaultChord: "Ctrl+Shift+KeyF",
  },
  {
    id: "terminal.splitRight",
    label: "Split terminal right",
    description: "Split the active tab into a second pane on the right.",
    scope: "terminal",
    defaultChord: "Ctrl+Shift+KeyD",
  },
  {
    id: "terminal.splitDown",
    label: "Split terminal down",
    description: "Split the active tab into a second pane below.",
    scope: "terminal",
    defaultChord: "Ctrl+Alt+Shift+KeyD",
  },
  {
    id: "terminal.nextTab",
    label: "Next terminal tab",
    description: "Cycle to the next terminal tab.",
    scope: "terminal",
    defaultChord: "Ctrl+Tab",
  },
  {
    id: "terminal.prevTab",
    label: "Previous terminal tab",
    description: "Cycle to the previous terminal tab.",
    scope: "terminal",
    defaultChord: "Ctrl+Shift+Tab",
  },
];

/** Merged binding map: action id → chord. */
export type HotkeyBindings = Readonly<Record<string, string>>;

/** The built-in defaults as a flat id → chord map. */
export const DEFAULT_CHORDS: HotkeyBindings = Object.freeze(
  Object.fromEntries(HOTKEY_ACTIONS.map((action) => [action.id, action.defaultChord])),
);

export function actionsForScope(scope: HotkeyScope): readonly HotkeyAction[] {
  return HOTKEY_ACTIONS.filter((action) => action.scope === scope);
}
