# Grove — Brand

> Codename was **SWARM**. The shipping product is **Grove**. The rationale and the
> name decision are recorded as **ADR-0010** in `DECISIONS.md`; the visual system
> lives in `docs/design-system.md`.

## The name

**Grove.** CLI verb: `grove` (`grove start`, `grove status`, `grove ls`).

A git **worktree** is, literally, a *tree*: many worktrees branch off one repository and
share a single `.git` object store — **one root system, many trees.** That is a grove. Grove
is where your swarm of coding agents works: one project, a cultivated stand of isolated
worktrees, an agent growing each one. You watch the whole grove from a single console and
harvest the branches that came good.

It is original and ownable, trivially typeable as a command, and a name we own outright rather
than a borrowed one. It also anchors a coherent design point of view (below) instead of being a
label bolted on.

## Positioning

Mission control for a swarm of coding agents — **calm surface, swarming depth.**

Grove orchestrates many CLI coding agents in parallel, each pinned to its own isolated git
worktree, with a built-in terminal, a diff viewer/editor, and real-time multi-agent
monitoring — on desktop and phone, fully self-hosted and OSS. The promise is *order imposed
on parallel chaos*: ten or a hundred agents running at once, every one legible at a glance,
none of them fighting for your attention until they’ve earned it.

Who it is for: developers who already live in a terminal and want to run an army of agents
without losing the thread. The product should feel like a cockpit or a trading terminal, not
a marketing site.

## Voice & tone

- **Operator, not hype-man.** Short, precise, technical. We say what a thing does and what it
  costs. No exclamation marks, no "blazingly fast," no growth-deck adjectives.
- **Terse by default.** A dense tool earns trust by respecting attention. Labels are nouns and
  verbs; errors state what broke and the way forward.
- **Honest about state.** "Running," "needs attention," "error," "done" — never a spinner that
  means nothing. Status is a signal, and signals must be true.
- **Quietly confident.** The calm in "calm surface, swarming depth." We don’t shout because the
  work is loud enough.

Words we use: workspace, worktree, agent, run, host, swarm, harvest, idle, attention.
Words we avoid: revolutionary, magical, effortless, 10x, unleash.

## Logo

**App mark** (`assets/grove-mark.svg`): a single trunk that forks into three shoots, each
tipped with a filled node. It reads three ways at once — a plant/grove growing from one root,
a `git`-branch fork, and a swarm fanning out. The three nodes are deliberately the same dots
as the product’s **AgentStatusDot**, so the identity and the live UI share one vocabulary.
Monoline, 2.4px stroke, rounded joints; drawn on a 32-unit grid.

**Wordmark** (`assets/grove-wordmark.svg`): the mark plus "Grove" set in **IBM Plex Sans
SemiBold (600)** at roughly -2% tracking. The canonical wordmark outlines that setting; the
shipped SVG references the family directly so it stays editable. On dark surfaces the logotype
is `--color-fg` (`#e8edea`) with the accent-green mark; the light variant swaps the logotype to
`#101714` and keeps the mark green.

**Clear space & color.** Keep clear space equal to the mark’s node diameter on all sides. The
mark is brand green (`#3fb950`) on dark; on light it darkens to `#178035` for contrast. Never
recolor the mark to a non-semantic hue, never add a gradient, never set the logotype in a
different family.

## Assets

| File | Use |
|---|---|
| `assets/grove-mark.svg` | App icon, favicon source, square avatar (32-unit grid). |
| `assets/grove-wordmark.svg` | Headers, docs, the showcase top bar. |

The in-app mark is also implemented as a React component in the showcase
(`apps/showcase/src/App.tsx`) so it inherits `currentColor` and the type system.
