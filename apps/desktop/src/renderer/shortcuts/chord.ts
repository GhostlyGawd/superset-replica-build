/**
 * Keyboard-chord encoding for the customizable-shortcuts system (P09). A chord is
 * a layout-independent string built from `KeyboardEvent.code` plus modifiers in a
 * canonical order (`Ctrl`, `Alt`, `Shift`, `Meta`), e.g. `Ctrl+Shift+KeyT`,
 * `Ctrl+Tab`, `Ctrl+Alt+ArrowDown`, `Ctrl+Comma`. Using `code` (not `key`) keeps a
 * binding stable across keyboard layouts and is exactly what the capture UI records.
 */

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** True when a key event carries only a modifier (not yet a complete chord). */
export function isModifierOnly(event: KeyboardEvent): boolean {
  return MODIFIER_CODES.has(event.code);
}

/** Encode a key event as a canonical chord, or `null` for a lone modifier press. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  if (isModifierOnly(event)) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Meta");
  }
  parts.push(event.code);
  return parts.join("+");
}

/** True when the event is exactly the given chord (modifiers + code all match). */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  return chordFromEvent(event) === chord;
}

const ARROWS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const PUNCTUATION: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "Backspace",
  Delete: "Del",
};

function prettyKey(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    return letter[1] as string;
  }
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    return digit[1] as string;
  }
  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) {
    return `Num${numpad[1]}`;
  }
  return ARROWS[code] ?? PUNCTUATION[code] ?? code;
}

/** Human-readable label for a chord, e.g. `Ctrl+Shift+T`, `Ctrl+↓`, `Ctrl+,`. */
export function formatChord(chord: string): string {
  if (chord.length === 0) {
    return "Unbound";
  }
  const tokens = chord.split("+");
  const code = tokens.pop() ?? "";
  return [...tokens, prettyKey(code)].join("+");
}
