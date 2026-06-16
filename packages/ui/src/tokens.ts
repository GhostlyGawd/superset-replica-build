/**
 * Grove design tokens — the typed source of truth (RUBRIC §6.3).
 *
 * These values mirror `tokens.css` exactly. Components never import hexes; they
 * use Tailwind utilities that resolve to the CSS custom properties, so theme
 * switching is a `data-theme` swap with no rebuild. This module exists for three
 * jobs: (1) a typed export consumers can introspect, (2) the contrast test that
 * enforces every AA claim, (3) the showcase galleries that render the system.
 */

/** Color roles, identical key set across themes. */
export interface ThemeColors {
  /** Recessed wells: terminal body, code/diff surface. */
  readonly insetBg: string;
  /** Application background (deepest chrome). */
  readonly baseBg: string;
  /** Panels, sidebars, primary surfaces. */
  readonly surfaceBg: string;
  /** Raised surfaces: cards, inputs, list rows. */
  readonly raisedBg: string;
  /** Floating surfaces: dialogs, sheets, popovers, tooltips, toasts. */
  readonly overlayBg: string;

  readonly lineSubtle: string;
  readonly line: string;
  readonly lineStrong: string;

  /** Primary text. */
  readonly fg: string;
  /** Secondary text, labels. */
  readonly fgMuted: string;
  /** Tertiary text: meta, ghost/hint text, disabled. */
  readonly fgSubtle: string;
  /** Text on a filled accent surface. */
  readonly fgOnAccent: string;

  /** Brand accent — selection, focus, primary action. */
  readonly accent: string;
  /** Accent as text/links on a dark/light surface. */
  readonly accentFg: string;

  /** Agent + signal states: solid (dots/fills/borders) + fg (text). */
  readonly idle: string;
  readonly idleFg: string;
  readonly running: string;
  readonly runningFg: string;
  readonly attention: string;
  readonly attentionFg: string;
  readonly error: string;
  readonly errorFg: string;
  readonly success: string;
  readonly successFg: string;
  readonly info: string;
  readonly infoFg: string;

  /** Diff line foregrounds (rendered over the inset surface). */
  readonly diffAddFg: string;
  readonly diffRemoveFg: string;
}

/**
 * Dark theme — the primary surface. Grove is dark-first: a calm, near-black
 * green-leaning substrate so semantic color reads as signal, not decoration.
 */
export const darkColors: ThemeColors = {
  insetBg: "#0a0d0c",
  baseBg: "#0e1211",
  surfaceBg: "#141817",
  raisedBg: "#1a201e",
  overlayBg: "#212826",

  lineSubtle: "#242c29",
  line: "#313b36",
  lineStrong: "#5d685f",

  fg: "#e8edea",
  fgMuted: "#aab4af",
  fgSubtle: "#8b958f",
  fgOnAccent: "#06120a",

  accent: "#3fb950",
  accentFg: "#57d364",

  idle: "#8b968f",
  idleFg: "#aab4af",
  running: "#2bbecf",
  runningFg: "#5ad6e6",
  attention: "#e0a93c",
  attentionFg: "#f2c14e",
  error: "#e5484d",
  errorFg: "#f57579",
  success: "#3fb950",
  successFg: "#57d364",
  info: "#4c8df6",
  infoFg: "#7aacff",

  diffAddFg: "#57d364",
  diffRemoveFg: "#f57579",
};

/**
 * Light theme — the considered secondary. Same role semantics; hues darkened to
 * hold AA on light surfaces. Never an afterthought, but never the default.
 */
export const lightColors: ThemeColors = {
  insetBg: "#eceeed",
  baseBg: "#f4f6f5",
  surfaceBg: "#ffffff",
  raisedBg: "#fbfcfb",
  overlayBg: "#ffffff",

  lineSubtle: "#e7eae8",
  line: "#d6dcd8",
  lineStrong: "#888f89",

  fg: "#101714",
  fgMuted: "#515b56",
  fgSubtle: "#677069",
  fgOnAccent: "#ffffff",

  accent: "#178035",
  accentFg: "#157032",

  idle: "#5d665f",
  idleFg: "#515b56",
  running: "#0e7c8c",
  runningFg: "#0c6675",
  attention: "#9a6400",
  attentionFg: "#7c5000",
  error: "#c5343a",
  errorFg: "#b32a30",
  success: "#1f8c3a",
  successFg: "#157032",
  info: "#1d63d8",
  infoFg: "#1450b8",

  diffAddFg: "#157032",
  diffRemoveFg: "#b32a30",
};

export const THEMES = { dark: darkColors, light: lightColors } as const;
export type ThemeName = keyof typeof THEMES;

/** A documented, test-enforced AA claim. */
export interface ContrastClaim {
  readonly theme: ThemeName;
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
  /** Minimum acceptable ratio (4.5 normal text, 3 large text / non-text UI). */
  readonly min: number;
}

function claimsFor(theme: ThemeName, c: ThemeColors): readonly ContrastClaim[] {
  return [
    // --- normal text, 4.5:1 ---
    { theme, label: "fg on base", fg: c.fg, bg: c.baseBg, min: 4.5 },
    { theme, label: "fg on surface", fg: c.fg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "fg on raised", fg: c.fg, bg: c.raisedBg, min: 4.5 },
    { theme, label: "fg on overlay", fg: c.fg, bg: c.overlayBg, min: 4.5 },
    { theme, label: "fg-muted on surface", fg: c.fgMuted, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "fg-muted on raised", fg: c.fgMuted, bg: c.raisedBg, min: 4.5 },
    { theme, label: "fg-subtle on surface", fg: c.fgSubtle, bg: c.surfaceBg, min: 4.5 },
    // fg-subtle also styles meta/hint text on raised (cards/inputs/rows) and overlay
    // (dialogs/sheets/popovers/toasts) surfaces — both must clear AA, not just surface.
    { theme, label: "fg-subtle on raised", fg: c.fgSubtle, bg: c.raisedBg, min: 4.5 },
    { theme, label: "fg-subtle on overlay", fg: c.fgSubtle, bg: c.overlayBg, min: 4.5 },
    { theme, label: "accent-fg (link) on surface", fg: c.accentFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "fg-on-accent on accent fill", fg: c.fgOnAccent, bg: c.accent, min: 4.5 },
    { theme, label: "running-fg on surface", fg: c.runningFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "attention-fg on surface", fg: c.attentionFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "error-fg on surface", fg: c.errorFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "success-fg on surface", fg: c.successFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "info-fg on surface", fg: c.infoFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "idle-fg on surface", fg: c.idleFg, bg: c.surfaceBg, min: 4.5 },
    { theme, label: "diff-add-fg on inset", fg: c.diffAddFg, bg: c.insetBg, min: 4.5 },
    { theme, label: "diff-remove-fg on inset", fg: c.diffRemoveFg, bg: c.insetBg, min: 4.5 },
    // --- non-text UI: status dots, focus ring, borders-as-signal, 3:1 ---
    { theme, label: "accent (focus ring) on base", fg: c.accent, bg: c.baseBg, min: 3 },
    { theme, label: "accent (focus ring) on surface", fg: c.accent, bg: c.surfaceBg, min: 3 },
    { theme, label: "running dot on surface", fg: c.running, bg: c.surfaceBg, min: 3 },
    { theme, label: "attention dot on surface", fg: c.attention, bg: c.surfaceBg, min: 3 },
    { theme, label: "error dot on surface", fg: c.error, bg: c.surfaceBg, min: 3 },
    { theme, label: "success dot on surface", fg: c.success, bg: c.surfaceBg, min: 3 },
    { theme, label: "info dot on surface", fg: c.info, bg: c.surfaceBg, min: 3 },
    { theme, label: "idle dot on surface", fg: c.idle, bg: c.surfaceBg, min: 3 },
    { theme, label: "line-strong on surface", fg: c.lineStrong, bg: c.surfaceBg, min: 3 },
  ];
}

/** Every AA claim the system makes, across both themes. */
export const CONTRAST_CLAIMS: readonly ContrastClaim[] = [
  ...claimsFor("dark", darkColors),
  ...claimsFor("light", lightColors),
];

/** Display row for a scale gallery. */
export interface ScaleRow {
  readonly token: string;
  readonly value: string;
  readonly note?: string;
}

/**
 * Spacing — a 4px base grid (Tailwind's numeric scale is adopted deliberately;
 * it is a well-formed 4px system and matches our dense rhythm). Exposed as
 * `--space-*` for CSS consumers; most layout uses Tailwind's gap/padding scale.
 */
export const SPACE: readonly ScaleRow[] = [
  { token: "0", value: "0" },
  { token: "px", value: "1px" },
  { token: "0.5", value: "2px" },
  { token: "1", value: "4px" },
  { token: "1.5", value: "6px" },
  { token: "2", value: "8px" },
  { token: "3", value: "12px" },
  { token: "4", value: "16px" },
  { token: "5", value: "20px" },
  { token: "6", value: "24px" },
  { token: "8", value: "32px" },
  { token: "10", value: "40px" },
  { token: "12", value: "48px" },
  { token: "16", value: "64px" },
];

/** Radii — engineered, not pillowy. 5px is the default control radius. */
export const RADII: readonly ScaleRow[] = [
  { token: "none", value: "0", note: "tables, full-bleed wells" },
  { token: "xs", value: "2px", note: "badges, tags, inline chips" },
  { token: "sm", value: "3px", note: "nested controls" },
  { token: "md", value: "5px", note: "default — buttons, inputs, cards" },
  { token: "lg", value: "8px", note: "panels, dialogs" },
  { token: "xl", value: "12px", note: "sheets, large overlays" },
  { token: "full", value: "9999px", note: "dots, avatars, pills" },
];

/** Type scale (rem on a 16px root → scales with user zoom). */
export const TYPE_SCALE: readonly ScaleRow[] = [
  { token: "2xs", value: "11px / 16", note: "micro labels, badge text, table meta" },
  { token: "xs", value: "12px / 16", note: "captions, dense table cells" },
  { token: "sm", value: "13px / 18", note: "base UI — body, controls, lists" },
  { token: "base", value: "14px / 20", note: "emphasized body, panel titles" },
  { token: "lg", value: "16px / 22", note: "section headings" },
  { token: "xl", value: "20px / 26", note: "view titles" },
  { token: "2xl", value: "24px / 30", note: "page titles" },
  { token: "3xl", value: "30px / 36", note: "brand / marketing only" },
];

/** Elevation — dark UI lifts with a lighter surface + border + soft shadow. */
export const ELEVATION: readonly ScaleRow[] = [
  { token: "shadow-sm", value: "0 1px 2px rgb(0 0 0 / 0.30)", note: "raised rows, inputs" },
  { token: "shadow-md", value: "0 6px 18px rgb(0 0 0 / 0.40)", note: "popovers, menus, toasts" },
  { token: "shadow-lg", value: "0 18px 48px rgb(0 0 0 / 0.55)", note: "dialogs, sheets" },
];

/** Motion — short and purposeful; communicates state + spatial origin. */
export const MOTION: readonly ScaleRow[] = [
  { token: "duration-instant", value: "80ms", note: "hover, focus, color shifts" },
  { token: "duration-fast", value: "120ms", note: "toggles, tooltips, badges" },
  { token: "duration-base", value: "180ms", note: "popovers, menus, toast enter" },
  { token: "duration-slow", value: "240ms", note: "dialogs, sheets" },
  {
    token: "ease-standard",
    value: "cubic-bezier(0.2, 0, 0, 1)",
    note: "enter / move (decelerate)",
  },
  { token: "ease-exit", value: "cubic-bezier(0.4, 0, 1, 1)", note: "exit (accelerate)" },
];

export const FONT_SANS = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, "Cascadia Code", "Consolas", monospace';
