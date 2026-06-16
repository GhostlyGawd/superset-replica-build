import type { Session, Workspace } from "@swarm/db";
import {
  AgentStatusDot,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Sheet,
  Spinner,
  StatusBadge,
} from "@swarm/ui/react";
import { Bot, CheckCircle2, FileDiff, GitBranch, Star } from "lucide-react";
import type { ReactNode } from "react";
import { isSessionActive, useGitStatus, useSessions } from "./host-reads.ts";
import { type HostState, effectiveStatus } from "./useHost.ts";

interface WorkspaceDetailSheetProps {
  readonly host: HostState;
  /** Which worktree's detail is open; `null` closes the sheet. */
  readonly workspaceId: string | null;
  readonly activeWorkspaceId: string | null;
  readonly onClose: () => void;
  readonly onSetActive: (id: string) => void;
  /** Jump to the Diff tab focused on this worktree. */
  readonly onReviewDiff: (id: string) => void;
}

function SectionLabel({ children }: { readonly children: string }) {
  return (
    <h3 className="px-0.5 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
      {children}
    </h3>
  );
}

function MetaRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">{children}</dd>
    </div>
  );
}

/** Short, lifecycle-aware label + tone for an agent session's own status string. */
function sessionBadge(session: Session): {
  tone: "running" | "neutral" | "success" | "error";
  label: string;
} {
  if (isSessionActive(session)) {
    return { tone: "running", label: session.status === "starting" ? "Starting" : "Running" };
  }
  if (session.status === "error" || (session.exitCode !== null && session.exitCode !== 0)) {
    return { tone: "error", label: "Error" };
  }
  return { tone: "success", label: "Done" };
}

/** One agent session row (adapter + lifecycle badge). */
function SessionItem({ session }: { readonly session: Session }) {
  const badge = sessionBadge(session);
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Bot className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <span className="truncate font-mono text-xs text-fg">{session.adapterId}</span>
      </span>
      <Badge tone={badge.tone} dot>
        {badge.label}
      </Badge>
    </li>
  );
}

/**
 * The phone workspace-detail surface (W3): a single-column Sheet over the live host.
 * Shows the worktree's branch + ahead/behind (`workspaces.gitStatus`), its live
 * status and running agents (sync overlay + `sessions.list`), and the full session
 * history — all REAL reads. Lets the operator make this worktree the active one and
 * jump to its read-only diff. No host writes happen here (those are W4).
 */
export function WorkspaceDetailSheet({
  host,
  workspaceId,
  activeWorkspaceId,
  onClose,
  onSetActive,
  onReviewDiff,
}: WorkspaceDetailSheetProps) {
  const workspace: Workspace | undefined = host.workspaces.find((ws) => ws.id === workspaceId);
  const open = workspaceId !== null && workspace !== undefined;
  const git = useGitStatus(host.client, open ? workspaceId : null);
  const sessions = useSessions(host.client, open ? workspaceId : null);

  const liveStatus = workspace ? effectiveStatus(workspace, host.liveStatus) : "idle";
  const isActive = workspace?.id === activeWorkspaceId;
  const activeSessions = sessions.state === "ready" ? sessions.value.filter(isSessionActive) : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      title={workspace?.name ?? "Workspace"}
      description={workspace ? `Worktree on ${workspace.branch}` : undefined}
    >
      {workspace ? (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <SectionLabel>Status</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={liveStatus} />
              {isActive ? (
                <Badge tone="accent" dot>
                  Active worktree
                </Badge>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>Branch</SectionLabel>
            <dl className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-xs">
              <MetaRow label="Branch">
                <GitBranch className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <span className="truncate font-mono text-fg">
                  {git.state === "ready"
                    ? (git.value.branch ?? workspace.branch)
                    : workspace.branch}
                </span>
              </MetaRow>
              <MetaRow label="Base">
                <span className="truncate font-mono text-fg-muted">{workspace.baseBranch}</span>
              </MetaRow>
              <MetaRow label="Ahead / behind">
                {git.state === "loading" ? (
                  <Spinner size="sm" label="Reading git status" />
                ) : git.state === "ready" ? (
                  git.value.ahead === 0 && git.value.behind === 0 ? (
                    <Badge tone="neutral">In sync with {workspace.baseBranch}</Badge>
                  ) : (
                    <span className="flex items-center gap-1.5 font-mono tabular-nums text-fg">
                      <span className="text-success-fg">↑{git.value.ahead}</span>
                      <span className="text-attention-fg">↓{git.value.behind}</span>
                    </span>
                  )
                ) : (
                  <span className="text-fg-subtle">Unavailable</span>
                )}
              </MetaRow>
              <MetaRow label="Working tree">
                {git.state === "ready" ? (
                  git.value.dirty ? (
                    <Badge tone="attention">{git.value.changedFiles} changed</Badge>
                  ) : (
                    <Badge tone="success">Clean</Badge>
                  )
                ) : git.state === "loading" ? (
                  <Spinner size="sm" label="Reading git status" />
                ) : (
                  <span className="text-fg-subtle">Live git status unavailable</span>
                )}
              </MetaRow>
            </dl>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>Running agents</SectionLabel>
            {activeSessions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {activeSessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <AgentStatusDot status={liveStatus} />
                      <span className="truncate font-mono text-xs text-fg">
                        {session.adapterId}
                      </span>
                    </span>
                    <StatusBadge status={liveStatus} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-line bg-inset px-3 py-2 text-xs text-fg-muted">
                No agent is running in this worktree right now.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>Session history</SectionLabel>
            {sessions.state === "loading" ? (
              <div className="grid place-items-center py-6">
                <Spinner size="lg" label="Loading sessions" />
              </div>
            ) : sessions.state === "error" ? (
              <ErrorState title="Could not load sessions" description={sessions.error} />
            ) : sessions.value.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 />}
                title="No sessions yet"
                description="Dispatch an agent from the Grove desktop app and its runs appear here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {sessions.value.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant={isActive ? "secondary" : "primary"}
              icon={<Star className="size-4" />}
              className="min-h-11 w-full"
              disabled={isActive}
              onClick={() => onSetActive(workspace.id)}
            >
              {isActive ? "Active worktree" : "Make active worktree"}
            </Button>
            <Button
              variant="secondary"
              icon={<FileDiff className="size-4" />}
              className="min-h-11 w-full"
              onClick={() => onReviewDiff(workspace.id)}
            >
              Review changes
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
