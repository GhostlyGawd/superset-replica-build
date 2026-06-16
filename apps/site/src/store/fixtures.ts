import type { ChangeType, WorkspaceStatus } from "@swarm/db";
import type { DiffLine } from "@swarm/ui/react";

/**
 * The fixed roster the whole page operates over. Real-shaped, honest data: a
 * mix of agents (Claude Code, Codex, Cursor, Gemini, Aider, opencode) each
 * pinned to its own `.grove/wt/<name>` worktree. The cockpit store seeds from
 * this; sections read derived views of it; nothing here autoplays.
 *
 * `startedAtOffsetMs` is "milliseconds ago at first paint" — the shared rAF
 * clock turns it into a live elapsed timer after hydration without ever
 * fabricating a wall-clock the server couldn't know.
 */
export interface RosterAgent {
  readonly id: string;
  readonly agent: string;
  readonly branch: string;
  readonly worktree: string;
  readonly run: string;
  readonly status: WorkspaceStatus;
  /** +/- line counts for the Δ column. */
  readonly additions: number;
  readonly deletions: number;
  /** How long ago this run started, at the moment the page is served. */
  readonly startedAtOffsetMs: number;
}

export const ROSTER: readonly RosterAgent[] = [
  {
    id: "auth-flow",
    agent: "Claude Code",
    branch: "fix/auth-flow",
    worktree: ".grove/wt/auth-flow",
    run: "bun test auth/",
    status: "running",
    additions: 64,
    deletions: 12,
    startedAtOffsetMs: 134_000,
  },
  {
    id: "port-scanner",
    agent: "Codex",
    branch: "feat/ports",
    worktree: ".grove/wt/port-scanner",
    run: "cargo run -- scan",
    status: "needs_attention",
    additions: 28,
    deletions: 4,
    startedAtOffsetMs: 41_000,
  },
  {
    id: "diff-virtualize",
    agent: "Cursor",
    branch: "perf/diff",
    worktree: ".grove/wt/diff-virtualize",
    run: "bun run bench:diff",
    status: "done",
    additions: 211,
    deletions: 96,
    startedAtOffsetMs: 742_000,
  },
  {
    id: "sync-resume",
    agent: "Gemini",
    branch: "feat/sync",
    worktree: ".grove/wt/sync-resume",
    run: "bun test sync/",
    status: "error",
    additions: 9,
    deletions: 31,
    startedAtOffsetMs: 318_000,
  },
  {
    id: "keyboard-docs",
    agent: "Aider",
    branch: "docs/hotkeys",
    worktree: ".grove/wt/keyboard-docs",
    run: "bun run docs:check",
    status: "idle",
    additions: 0,
    deletions: 0,
    startedAtOffsetMs: 3_600_000,
  },
  {
    id: "pty-backpressure",
    agent: "Claude Code",
    branch: "fix/pty-backpressure",
    worktree: ".grove/wt/pty-backpressure",
    run: "bun test pty/",
    status: "running",
    additions: 47,
    deletions: 18,
    startedAtOffsetMs: 96_000,
  },
  {
    id: "pglite-migrate",
    agent: "Codex",
    branch: "chore/migrate",
    worktree: ".grove/wt/pglite-migrate",
    run: "bun run db:migrate",
    status: "running",
    additions: 132,
    deletions: 40,
    startedAtOffsetMs: 222_000,
  },
  {
    id: "qr-pairing",
    agent: "Cursor",
    branch: "feat/qr-pair",
    worktree: ".grove/wt/qr-pairing",
    run: "bun test pairing/",
    status: "done",
    additions: 88,
    deletions: 14,
    startedAtOffsetMs: 905_000,
  },
  {
    id: "adapter-codex",
    agent: "opencode",
    branch: "feat/adapter-codex",
    worktree: ".grove/wt/adapter-codex",
    run: "bun test adapters/",
    status: "running",
    additions: 56,
    deletions: 9,
    startedAtOffsetMs: 158_000,
  },
  {
    id: "toast-throttle",
    agent: "Claude Code",
    branch: "fix/toast-throttle",
    worktree: ".grove/wt/toast-throttle",
    run: "bun test ui/",
    status: "running",
    additions: 22,
    deletions: 6,
    startedAtOffsetMs: 73_000,
  },
  {
    id: "host-bearer",
    agent: "Gemini",
    branch: "feat/bearer",
    worktree: ".grove/wt/host-bearer",
    run: "bun test host/",
    status: "needs_attention",
    additions: 38,
    deletions: 21,
    startedAtOffsetMs: 64_000,
  },
  {
    id: "worktree-prune",
    agent: "Aider",
    branch: "chore/prune",
    worktree: ".grove/wt/worktree-prune",
    run: "bun run gc:worktrees",
    status: "running",
    additions: 14,
    deletions: 52,
    startedAtOffsetMs: 189_000,
  },
  {
    id: "ansi-palette",
    agent: "Codex",
    branch: "feat/ansi-map",
    worktree: ".grove/wt/ansi-palette",
    run: "bun test terminal/",
    status: "running",
    additions: 71,
    deletions: 11,
    startedAtOffsetMs: 112_000,
  },
  {
    id: "reduced-motion",
    agent: "Cursor",
    branch: "a11y/reduced-motion",
    worktree: ".grove/wt/reduced-motion",
    run: "bun run test:a11y",
    status: "running",
    additions: 33,
    deletions: 7,
    startedAtOffsetMs: 205_000,
  },
];

/** Summary counts derived from a roster slice — used by the rail tally + dial caption. */
export interface RosterTally {
  readonly total: number;
  readonly running: number;
  readonly attention: number;
  readonly idle: number;
  readonly done: number;
  readonly error: number;
}

export function tally(agents: readonly RosterAgent[]): RosterTally {
  let running = 0;
  let attention = 0;
  let idle = 0;
  let done = 0;
  let error = 0;
  for (const a of agents) {
    if (a.status === "running") running += 1;
    else if (a.status === "needs_attention") attention += 1;
    else if (a.status === "idle") idle += 1;
    else if (a.status === "done") done += 1;
    else if (a.status === "error") error += 1;
  }
  return { total: agents.length, running, attention, idle, done, error };
}

// --- Section fixtures (real-shaped sample surfaces) ---

export const ISOLATED_DIFF = {
  path: ".grove/wt/auth-flow/src/session.ts",
  changeType: "modified" as ChangeType,
  additions: 6,
  deletions: 1,
  lines: [
    { type: "hunk", text: "@@ -18,7 +18,12 @@ export function refreshSession(token: Token) {" },
    { type: "context", oldNumber: 18, newNumber: 18, text: "  const claims = decode(token);" },
    { type: "context", oldNumber: 19, newNumber: 19, text: "  if (claims.exp < now()) {" },
    { type: "remove", oldNumber: 20, text: "    throw new Expired();" },
    { type: "add", newNumber: 20, text: "    // Rotate instead of failing the open session." },
    { type: "add", newNumber: 21, text: "    const next = rotate(claims);" },
    { type: "add", newNumber: 22, text: "    audit.record(next.id, claims.sub);" },
    { type: "add", newNumber: 23, text: "    return next;" },
    { type: "add", newNumber: 24, text: "  }" },
    { type: "add", newNumber: 25, text: "  return token;" },
    { type: "context", oldNumber: 21, newNumber: 26, text: "}" },
  ] satisfies readonly DiffLine[],
};

export const SHARED_DIFF = {
  path: "src/session.ts",
  changeType: "modified" as ChangeType,
  additions: 3,
  deletions: 5,
  lines: [
    { type: "hunk", text: "@@ -18,11 +18,9 @@ <<<<<<< two agents, one checkout" },
    { type: "remove", oldNumber: 18, text: "  const claims = decode(token); // agent-a" },
    { type: "remove", oldNumber: 19, text: "  if (claims.exp < now()) {" },
    { type: "remove", oldNumber: 20, text: "    throw new Expired();" },
    { type: "context", oldNumber: 21, newNumber: 18, text: "  // agent-b also edited this hunk" },
    { type: "remove", oldNumber: 22, text: "  return rotate(claims);" },
    { type: "add", newNumber: 19, text: "<<<<<<< HEAD" },
    { type: "add", newNumber: 20, text: "  return token; // overwritten, work lost" },
    { type: "add", newNumber: 21, text: ">>>>>>> feat/ports" },
  ] satisfies readonly DiffLine[],
};

export const HARVEST_DIFF = {
  path: ".grove/wt/diff-virtualize/packages/ui/src/react/DiffView.tsx",
  changeType: "modified" as ChangeType,
  additions: 5,
  deletions: 2,
  lines: [
    { type: "hunk", text: "@@ -91,9 +91,12 @@ export function DiffView(props: DiffViewProps) {" },
    { type: "context", oldNumber: 91, newNumber: 91, text: "  return (" },
    { type: "context", oldNumber: 92, newNumber: 92, text: "    <div className={cn(" },
    { type: "remove", oldNumber: 93, text: '      "overflow-auto",' },
    { type: "add", newNumber: 93, text: '      "overflow-auto grove-grid-contain",' },
    { type: "add", newNumber: 94, text: "      // content-visibility: skip offscreen hunks" },
    { type: "add", newNumber: 95, text: "      // so a 4k-line diff scrolls at 60fps." },
    { type: "context", oldNumber: 94, newNumber: 96, text: "    )}>" },
    { type: "add", newNumber: 97, text: "      {/* virtualized below */}" },
    { type: "context", oldNumber: 95, newNumber: 98, text: "      {rows}" },
    { type: "remove", oldNumber: 96, text: "      {/* render every row up front */}" },
  ] satisfies readonly DiffLine[],
};

/** Recorded terminal session — replayed pull-only, labeled honestly. */
export interface TermLine {
  readonly tone:
    | "fg"
    | "muted"
    | "subtle"
    | "accent"
    | "running"
    | "success"
    | "error"
    | "attention";
  readonly text: string;
}

export interface TermSession {
  /** The shell descriptor shown in the frame footer. */
  readonly shell: string;
  /** The worktree this shell is pinned to (frame footer cwd). */
  readonly cwd: string;
  /** Geometry shown in the footer — tabular, reserved so it never shifts. */
  readonly cols: number;
  readonly rows: number;
  /** The recorded lines, replayed pull-only and held on the final frame. */
  readonly lines: readonly TermLine[];
}

/**
 * Each terminal tab is its OWN recorded session from a DIFFERENT agent — switching
 * tabs shows that agent's real `grove`/build output, not one shared body. Keyed by
 * the roster id so the tab strip, the footer (shell · cwd · geometry) and the body
 * all stay consistent. Three agents, three distinct outcomes: a paused test run
 * (Claude Code), a green PTY backpressure run (Claude Code), a port-scan that
 * surfaced a conflict (Codex). Nothing autoplays — replay is pull-only, per tab.
 */
const AUTH_FLOW_SESSION: TermSession = {
  shell: "pwsh 7.4",
  cwd: ".grove/wt/auth-flow",
  cols: 120,
  rows: 32,
  lines: [
    { tone: "subtle", text: "grove › auth-flow · pwsh 7.4 · .grove/wt/auth-flow" },
    { tone: "muted", text: "$ bun test auth/" },
    { tone: "fg", text: "bun test v1.3.14" },
    { tone: "success", text: "  ok  auth/login.test.ts        8 pass   142ms" },
    { tone: "success", text: "  ok  auth/session.test.ts      5 pass    61ms" },
    { tone: "error", text: "  fail  auth/refresh.test.ts     1 fail" },
    { tone: "subtle", text: "      expected 200 — received 401 (token expired)" },
    { tone: "fg", text: "  13 pass · 1 fail · 19 expect() calls" },
    { tone: "attention", text: "› agent paused — waiting on your input to continue" },
  ],
};

export const TERMINAL_SESSIONS: Readonly<Record<string, TermSession>> = {
  "auth-flow": AUTH_FLOW_SESSION,
  "pty-backpressure": {
    shell: "bash 5.2",
    cwd: ".grove/wt/pty-backpressure",
    cols: 120,
    rows: 32,
    lines: [
      { tone: "subtle", text: "grove › pty-backpressure · bash 5.2 · .grove/wt/pty-backpressure" },
      { tone: "muted", text: "$ bun test pty/" },
      { tone: "fg", text: "bun test v1.3.14" },
      { tone: "success", text: "  ok  pty/spawn.test.ts          6 pass    88ms" },
      { tone: "success", text: "  ok  pty/backpressure.test.ts   11 pass   213ms" },
      { tone: "success", text: "  ok  pty/resize.test.ts          4 pass    37ms" },
      { tone: "fg", text: "  21 pass · 0 fail · 34 expect() calls" },
      { tone: "muted", text: "$ grove status pty-backpressure" },
      { tone: "running", text: "› streaming 4.2 MB/s · ring buffer 12% · no dropped frames" },
    ],
  },
  ports: {
    shell: "pwsh 7.4",
    cwd: ".grove/wt/port-scanner",
    cols: 120,
    rows: 32,
    lines: [
      { tone: "subtle", text: "grove › port-scanner · pwsh 7.4 · .grove/wt/port-scanner" },
      { tone: "muted", text: "$ cargo run -- scan --loopback" },
      { tone: "fg", text: "   Compiling port-scanner v0.3.1" },
      { tone: "fg", text: "    Finished dev [unoptimized] in 2.41s" },
      { tone: "fg", text: "     Running `target/debug/port-scanner scan --loopback`" },
      { tone: "success", text: "  open   127.0.0.1:7433  grove-host (bearer)" },
      { tone: "success", text: "  open   127.0.0.1:5432  embedded-postgres (pglite)" },
      { tone: "attention", text: "  busy   127.0.0.1:9229  inspector already bound" },
      { tone: "attention", text: "› agent needs review — port 9229 conflicts with the debugger" },
    ],
  },
};

/** The default poster-frame session id (SSR'd; first tab is open at rest). */
export const DEFAULT_TERMINAL_TAB = "auth-flow";

/** The default session itself — a concrete value, so callers never index-fall-through. */
export const DEFAULT_TERMINAL_SESSION: TermSession = AUTH_FLOW_SESSION;
