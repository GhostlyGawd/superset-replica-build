# recon.md — Faithful Recon of the Original Superset

> Reference material for all later phases. This describes the **original** product
> (`superset-sh/superset`) as built, not our replica. Where a fact comes from a
> third-party write-up rather than the repo/docs, it is marked *(secondary)*.
> Source URLs are listed inline and collected at the bottom.

## 1. What it is

Superset bills itself as **"The Code Editor for the AI Agents Era — Run an army of
Claude Code, Codex, etc. on your machine."** It orchestrates many CLI coding agents in
parallel, each pinned to its own isolated git worktree, with a built-in terminal, diff
viewer/editor, in-app browser, chat panel, and an open-in-IDE handoff. It is a macOS-first
Electron app backed by a cloud account system; the desktop app talks to a **headless host
service** that owns the files, terminals, ports, and agent runs on a machine.

Company context *(secondary)*: a three-person team, YC Spring 2026 batch, #1 on Product
Hunt on 2026-02-27; free tier plus Pro at $20/seat/month. The repo itself is the source of
truth used below.

## 2. Feature list (marketing + docs, confirmed against repo)

The homepage and README advertise eight headline capabilities:

1. **Parallel Execution** — "Run 10+ coding agents simultaneously on your machine" (site copy elsewhere says 100+).
2. **Worktree Isolation** — "Each task gets its own branch and working directory."
3. **Agent Monitoring** — "Track agent status and get notified when changes are ready."
4. **Built-in Diff Viewer** — "Inspect and edit agent changes without leaving the app."
5. **Workspace Presets** — "Automate env setup, dependency installation, and more."
6. **Universal Compatibility** — "Works with any CLI agent that runs in a terminal."
7. **Quick Context Switching** — "Jump between tasks as they need your attention."
8. **IDE Integration** — "Open any workspace in your favorite editor with one click."

Beyond the headline list, the repo (`apps/desktop/src/lib/trpc/routers/*` and
`apps/docs/content/docs/*`) confirms these shipped surfaces:

- **Built-in terminal** with tabs, splits, presets, persistent host-side sessions ("closing
  a laptop doesn't kill the sessions").
- **In-app browser** (`browser`, `browser-history` routers) for docs and dev servers, with
  **port management / forwarding** (`ports` router, `packages/port-scanner`,
  `apps/desktop/.../static-ports`).
- **Chat panel** with chat-mode agents and attachments (`packages/chat`, `chat-service`,
  `chat-runtime-service` routers).
- **MCP tooling** — Superset both consumes and exposes MCP (`packages/mcp`, `packages/mcp-v2`,
  `apps/api/.../api/agent/[transport]` for the agent MCP transport).
- **Global command palette**, **customizable keyboard shortcuts** (full registry, see §5).
- **Remote workspaces** — host/client model over a relay (§7).
- **Automations** and **integrations**: GitHub (App + webhooks + sync), **Linear**, **Slack**,
  **Stripe** (`apps/api/.../api/integrations/*`, `automations` routes).
- **CLI** and a public **SDK** (`packages/cli`, `packages/cli-framework`, `packages/sdk`,
  `apps/docs/content/docs/cli/*`, `.../sdk/*`).
- **Custom themes** and a settings surface (`custom-themes.mdx`, `customization.mdx`).

## 3. Agent adapters

README adapter list (logos): **Amp Code, Claude Code, OpenAI Codex CLI, Cursor Agent, Droid,
Gemini CLI, GitHub Copilot, Mastra Code, OpenCode, Pi**, plus **"Any other CLI agent"** —
"If it runs in a terminal, it runs on Superset." The `agent-integration.mdx` doc lists the
built-ins as *Amp, Claude Code, Codex, OpenCode, Pi, Gemini CLI, and Cursor Agent* and says
agents are managed in **Settings → Agents**, where each agent exposes: enabled status,
command variations, prompt templates, model overrides, and restore-to-default.

Architecturally, the renderer has an **agent-session-orchestrator** with two adapter shapes
(`.../lib/agent-session-orchestrator/adapters/`):

- `terminal-adapter.ts` — the agent is a CLI process driven through a PTY (the universal
  path; this is how "any CLI agent" works zero-config — you give it a command and Superset
  launches it in a worktree-scoped terminal).
- `chat-adapter.ts` — richer agents are surfaced as a structured chat pane (streamed
  messages, attachments, tool calls) rather than raw terminal output.

Idle/"needs attention" status is derived from agent/terminal activity and surfaced to the
monitoring + notifications layer (the repo has a `ringtone` router and a `notifications`
main-process lib; exact idle-detection heuristic is not documented publicly).

## 4. Worktree isolation

Each task/workspace gets its **own git branch and working directory implemented as a git
worktree** (not a clone): worktrees share one `.git` object store, so they are cheap on disk
while fully isolating the checkout, index, and untracked files. The host
(`superset workspaces create --project … --name … --branch …`) "clones the project (if it
isn't already on disk), creates a git worktree at the chosen branch, and registers the
workspace." Existing on-disk worktrees can be **imported** (`external-worktree-import`,
`select-external-worktrees-for-import`, `resolve-worktree-path` under
`apps/desktop/.../workspaces/`). Deleting a workspace tears down the worktree (and optionally
the branch).

## 5. Keyboard shortcuts (authoritative)

From `apps/docs/content/docs/keyboard-shortcuts.mdx` (the macOS display column) cross-checked
against the source of truth `apps/desktop/src/renderer/hotkeys/registry.ts`, which also
defines a distinct **Windows/Linux** binding per action. The Windows column matters enormously
for our replica, because the original deliberately remaps almost everything from `⌘` to
`Ctrl+Shift+…` to avoid colliding with terminal control codes (`Ctrl+C/D/K/L/W` etc.).
Customizable in **Settings → Keyboard Shortcuts** with export/import.

| Action (id) | macOS | Windows/Linux | Group |
|---|---|---|---|
| New Workspace (`NEW_WORKSPACE`) | `⌘N` | `ctrl+shift+n` | Workspace |
| Quick Create Workspace (`QUICK_CREATE_WORKSPACE`) | `⌘⇧N` | `ctrl+shift+alt+n` | Workspace |
| Open Project (`OPEN_PROJECT`) | `⌘⇧O` | `ctrl+shift+alt+o` | Workspace |
| Switch to Workspace 1–9 (`JUMP_TO_WORKSPACE_1..9`) | `⌘1`–`⌘9` | `ctrl+shift+1..9` | Workspace |
| Previous / Next Workspace | `⌘⌥↑` / `⌘⌥↓` | `ctrl+shift+alt+up/down` | Workspace |
| Close Workspace (`CLOSE_WORKSPACE`) | `⌘⇧⌫` | `ctrl+shift+backspace` | Workspace |
| Run Workspace Command (`RUN_WORKSPACE_COMMAND`) | `⌘G` | `ctrl+shift+g` | Workspace |
| Focus Task Search (`FOCUS_TASK_SEARCH`) | `⌘F` | `ctrl+shift+f` | Workspace |
| Open / Create PR (`OPEN_PR`) | `⌘⇧P` | `ctrl+shift+alt+p` | Workspace |
| Toggle Changes Tab (`TOGGLE_SIDEBAR`) | `⌘L` | `ctrl+shift+l` | Layout |
| Open Diff Viewer (`OPEN_DIFF_VIEWER`) | `⌘⇧L` | `ctrl+shift+alt+l` | Layout |
| Toggle Workspaces Sidebar (`TOGGLE_WORKSPACE_SIDEBAR`) | `⌘B` | `ctrl+shift+b` | Layout |
| Split Right / Down / Auto | `⌘D` / `⌘⇧D` / `⌘E` | `ctrl+shift+d` / `…alt+d` / `ctrl+shift+e` | Layout |
| Split with Chat / Browser | `⌘⇧E` / `⌘⇧S` | `ctrl+alt+e` / `ctrl+shift+alt+s` | Layout |
| Equalize Pane Splits | `⌘⇧0` | `ctrl+shift+0` | Layout |
| Close Pane (`CLOSE_PANE`) | `⌘W` | `ctrl+shift+w` | Layout |
| Quick Open File (`QUICK_OPEN`) | `⌘P` | `ctrl+shift+p` | Navigation |
| Navigate Back / Forward | `⌘[` / `⌘]` | `ctrl+shift+bracketleft/right` | Navigation |
| New Terminal Tab (`NEW_GROUP`) | `⌘T` | `ctrl+shift+t` | Terminal |
| New Chat (`NEW_CHAT`) | `⌘⇧T` | `ctrl+shift+alt+t` | Terminal |
| New Browser (`NEW_BROWSER`) | `⌘⇧B` | `ctrl+shift+alt+b` | Terminal |
| Reopen Closed Tab (`REOPEN_TAB`) | `⌘⇧R` | `ctrl+shift+alt+r` | Terminal |
| Close Tab / Close Terminal | `⌘⇧W` / `⌘W` | `ctrl+shift+alt+w` / `ctrl+shift+w` | Terminal |
| Clear Terminal (`CLEAR_TERMINAL`) | `⌘K` | `ctrl+shift+k` | Terminal |
| Find in Terminal/File/Chat (`FIND_*`) | `⌘F` | `ctrl+shift+f` | Terminal |
| Scroll to Bottom | `⌘⇧↓` | `ctrl+end` | Terminal |
| Prev / Next Tab | `⌘⌥←` / `⌘⌥→` | `ctrl+shift+alt+left/right` | Terminal |
| Prev / Next Tab (alt) | `⌃⇧⇥` / `⌃⇥` | `ctrl+shift+tab` / `ctrl+tab` | Terminal |
| Prev / Next Pane | `⌘⇧←` / `⌘⇧→` | (focus-pane variants) | Terminal |
| Jump to Tab 1–9 | `⌘⌥1`–`⌘⌥9` | `ctrl+shift+alt+1..9` | Terminal |
| **Open Preset 1–9** (`OPEN_PRESET_1..9`) | `⌃1`–`⌃9` | `ctrl+1..9` | Terminal |
| Focus Chat Input (`FOCUS_CHAT_INPUT`) | `⌘J` | `ctrl+shift+j` | Terminal |
| Add Chat Attachment (`CHAT_ADD_ATTACHMENT`) | `⌘U` | `ctrl+shift+u` | Terminal |
| Open in App / external IDE (`OPEN_IN_APP`) | `⌘O` | `ctrl+shift+o` | Window |
| Copy Path (`COPY_PATH`) | `⌘⇧C` | `ctrl+shift+alt+c` | Window |
| Open Settings (`OPEN_SETTINGS`) | `⌘,` | `ctrl+comma` | Help |
| Show Keyboard Shortcuts (`SHOW_HOTKEYS`) | `⌘⇧/` | `ctrl+shift+slash` | Help |
| Open Command Palette (`OPEN_COMMAND_PALETTE`) | `⌘⇧K` | `ctrl+shift+k` | Help |

Note: `Open Preset 1–9` is the one binding that is `Ctrl+1`–`Ctrl+9` on **both** platforms,
matching the PARITY `P05` requirement of "preset slots (Ctrl+1–9)."

## 6. Config schema — `.superset/config.json`

Lives at the **project root** under `.superset/`. Three optional top-level fields, each an
array of shell command strings (`setup-teardown-scripts.mdx`):

```json
{
  "setup": [],
  "teardown": [],
  "run": []
}
```

- **`setup`** — runs in a terminal when a workspace is **created** (deps, env files, services).
- **`teardown`** — runs when a workspace is **deleted** (stop services, clean up).
- **`run`** — triggered by the **Run** button / `Run Workspace Command` (`⌘G`); executes in
  its own dedicated terminal pane.

Environment variables exposed to every script:

| Variable | Meaning |
|---|---|
| `SUPERSET_ROOT_PATH` | Path to the root repository (the project) |
| `SUPERSET_WORKSPACE_NAME` | Current workspace name |
| `SUPERSET_WORKSPACE_PATH` | Path to this workspace's worktree |

A **local overlay** form lets each field be an object with `before`/`after` arrays that
prepend/append to the committed config (e.g. machine-specific steps in a gitignored
`config.local.json`):

```json
{
  "setup": { "before": ["echo 'pre-setup'"], "after": ["./.superset/my-post-setup.sh"] },
  "teardown": { "after": ["./.superset/my-cleanup.sh"] }
}
```

Real examples from the docs:

```json
{ "setup": ["bun install", "cp \"$SUPERSET_ROOT_PATH/.env\" .env"] }
```
```json
{ "setup": ["docker-compose up -d", "bun run db:migrate"], "teardown": ["docker-compose down -v"] }
```
```json
{ "setup": ["./.superset/setup.sh"], "teardown": ["./.superset/teardown.sh"], "run": ["./.superset/run.sh"] }
```

(Note: the original's own examples shell out to `.sh` scripts — a macOS/POSIX assumption our
replica must not inherit; see ADR-0004.)

## 7. Client/host architecture + sync

**Host service** (`apps/docs/content/docs/cli/host-server.mdx`, `packages/host-service`,
`apps/desktop/src/main/host-service`): a **headless HTTP server** that "manages workspaces,
ports, and agent runs on the machine it's running on." Any Superset desktop app or CLI can
talk to it. Lifecycle:

```bash
superset auth login        # reuses gh auth; GH_TOKEN/GITHUB_TOKEN in CI/sandboxes
superset start --daemon    # background daemon, binds 127.0.0.1 ONLY
superset status            # health
superset stop
```

On start it writes a manifest at `~/.superset/host/<organizationId>/manifest.json`
containing the **endpoint + auth token**; clients locate the host by reading it. A host
started by the desktop app is visible to the CLI and vice-versa. The host registers with a
**relay** so other clients in the org can find it across machines.

**Remote workspaces** (`remote-workspaces.mdx`): a workspace "lives on the machine that hosts
its files, terminal, and ports." Remote access is enabled either via a **desktop settings
toggle** (which restarts the host service) or the **CLI daemon**. The **relay** "provides a
secure way to route traffic between your different devices." When a host comes online "the
user who started it is the only one with access"; teammates are granted access via an admin
surface. Disabling access stops relay traffic and interrupts in-flight terminals/host work.

**Data sync stack (original):** Postgres on **Neon** (cloud), state synced to clients via
**ElectricSQL** (Postgres logical-replication → client read sync). The repo carries
`apps/electric-proxy`, `apps/relay`, and `apps/streams` for this. Local dev brings up
**Postgres + neon-proxy + Electric via Docker Compose**. ORM is **Drizzle**
(`packages/db`, schema under `packages/db/src/schema/`, migrations via
`bunx drizzle-kit generate`).

> This Electric+Neon+Docker stack is exactly what our ADR-0003 replaces with **PGlite +
> our own WebSocket event-log sync** (no Docker, no paid cloud DB). See architecture.md §4.

## 8. Notifications

Agent monitoring drives notifications: "get notified when changes are ready" / when a
workspace "needs attention." Implemented in the desktop main process
(`apps/desktop/src/main/lib/notifications`) with a `ringtone` tRPC router for audible alerts.
Public docs do not specify push transport for mobile; the original's mobile client is a
React Native app (see §9), so notifications there would be native, not Web Push.

## 9. Monorepo topology (actual, from `git tree` + `AGENTS.md`)

**Runtime/stack:** Bun + Turborepo; Vite; Biome (CI fails on warnings); Electron (desktop);
**Next.js 16** (web/api/admin/marketing — note their rule "use `proxy.ts`, never
`middleware.ts`"); React + **TailwindCSS v4** + **shadcn/ui**; TanStack Router (desktop
renderer routes); tRPC; Drizzle ORM; Neon Postgres; ElectricSQL; node-pty; MCP.

**`apps/`**
| App | Purpose |
|---|---|
| `apps/desktop` | Electron app: `main/` (incl. `host-service/`), `renderer/` (TanStack Router, `hotkeys/`, panes), `lib/trpc/routers/*` (the in-app API surface) |
| `apps/api` | Next.js cloud backend: auth/OAuth (`better-auth` style `.well-known/*`), tRPC, MCP agent transport, GitHub/Linear/Slack/Stripe integrations, automations, hosts presence |
| `apps/web` | Main web app (`app.superset.sh`) |
| `apps/marketing` | Marketing site (`superset.sh`) |
| `apps/admin` | Internal analytics dashboard (funnels, retention, WAU, leaderboard) |
| `apps/docs` | Docs site (Fumadocs-style MDX under `content/docs/`) |
| `apps/mobile` | **React Native (Expo)** mobile app (`modules/tab-bar`, etc.) |
| `apps/electric-proxy` | ElectricSQL proxy |
| `apps/relay` | Relay for remote host/device routing |
| `apps/streams` | Streaming/event service |

**`packages/`**
| Package | Purpose |
|---|---|
| `packages/host-service` | The headless host engine (workspaces, ports, agent runs) |
| `packages/pty-daemon` | PTY process management (node-pty) as a daemon |
| `packages/workspace-fs` | Filesystem/worktree operations for a workspace |
| `packages/workspace-client` | Client library to talk to a host's workspaces |
| `packages/db` | Drizzle schema + migrations |
| `packages/local-db` | Local on-device DB (SQLite) |
| `packages/trpc` | Shared tRPC definitions/types |
| `packages/auth` | Authentication |
| `packages/chat` | Chat domain (agent chat panes) |
| `packages/mcp`, `packages/mcp-v2` | MCP integration (v1 + v2) |
| `packages/cli`, `packages/cli-framework` | `superset` CLI + its framework |
| `packages/sdk` | Public SDK |
| `packages/panes` | Pane/split layout engine |
| `packages/port-scanner` | Detect listening ports per workspace |
| `packages/ui` | shadcn/ui + Tailwind v4 shared components |
| `packages/email` | Transactional email |
| `packages/shared` | Shared utilities/types |
| `packages/macos-process-metrics` | **macOS-only** per-process CPU/mem (a portability gap we must replace) |
| `tooling/typescript` | Shared tsconfig |

## 10. Dev setup (original)

Prereqs: macOS (Windows/Linux "untested"), Bun v1.0+, Docker (Desktop/OrbStack), `jq`, Caddy
(`caddy trust` for local HTTPS so Chromium accepts it), Git 2.20+, GitHub CLI.

```bash
git clone https://github.com/superset-sh/superset.git
cd superset
./.superset/setup.local.sh   # env files, port ranges, Postgres+neon-proxy+Electric via Docker, migrations, dev admin
bun run dev
```

Sign in with **"Sign in as dev"** (or `admin@local.test` / `supersetdev`). Common scripts:
`bun dev`, `bun test`, `bun run lint:fix`, `bun run typecheck`, `bun run build`.
`AGENTS.md`/`CONTRIBUTING.md` hold conventions; DB changes go through
`packages/db/src/schema/` then `bunx drizzle-kit generate --name="<snake_case>"` (never edit
generated migrations).

## 11. Portability gaps the replica must close (carried into architecture.md)

- macOS-only assumptions: `.sh` scripts on user paths, `packages/macos-process-metrics`,
  Caddy `caddy trust` flow, `⌘`-centric default bindings (registry already has a
  Windows/Linux column — reuse its remapping logic).
- Heavy dev dependency on **Docker** (Postgres + neon-proxy + Electric) — removed by ADR-0003.
- Paid/cloud dependencies: **Neon** DB, hosted relay — replaced by self-hosted PGlite +
  WebSocket sync + OSS tunnel (cloudflared/localtunnel + Caddy) per ADR-0003/0009.
- React Native mobile pipeline — replaced by PWA-first per ADR-0006.

## Sources

- Repo + README: https://github.com/superset-sh/superset · https://github.com/superset-sh/superset/blob/main/README.md
- Marketing site: https://superset.sh/
- Docs: https://docs.superset.sh/ — `keyboard-shortcuts`, `setup-teardown-scripts`, `agent-integration`, `remote-workspaces`, `cli/host-server`, `terminal-presets`, `diff-viewer`, `ports`, `mcp` (raw under `https://raw.githubusercontent.com/superset-sh/superset/main/apps/docs/content/docs/`)
- Repo tree / package list: `gh api repos/superset-sh/superset/git/trees/HEAD?recursive=1`; `AGENTS.md`, `DEVELOPMENT.md`
- Hotkey source of truth: `apps/desktop/src/renderer/hotkeys/registry.ts`
- Context *(secondary)*: https://www.founderland.ai/articles/superset-launches-ide-to-orchestrate-100-ai-coding-agents-in-mpz8db7u · https://yuv.ai/blog/superset · https://www.everydev.ai/tools/superset-sh
