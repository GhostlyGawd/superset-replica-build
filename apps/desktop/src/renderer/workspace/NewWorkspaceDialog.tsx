import type { Workspace } from "@swarm/db";
import { Button, Dialog, EmptyState, Input, useToast } from "@swarm/ui/react";
import { FolderGit2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { HostTrpcClient } from "../../host-client.ts";

interface NewWorkspaceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly client: HostTrpcClient | null;
  /** Project the new worktree is cut in; `null` when no project is loaded yet. */
  readonly projectId: string | null;
  readonly onCreated: (workspace: Workspace) => void;
}

/** Branch name derived from a worktree name, mirroring the host's slug rules. */
function branchFor(name: string): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `grove/${slug.length > 0 ? slug : "workspace"}`;
}

/**
 * Create a new isolated worktree in the current project (P08). Collects a name +
 * base branch and calls the real `workspaces.create` mutation (which cuts a git
 * worktree on the host). Real submitting/error states; never a fake success.
 */
export function NewWorkspaceDialog({
  open,
  onOpenChange,
  client,
  projectId,
  onCreated,
}: NewWorkspaceDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (busy) {
      return;
    }
    if (!next) {
      setName("");
      setBaseBranch("main");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !projectId || name.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workspace = await client.workspaces.create.mutate({
        projectId,
        name: name.trim(),
        branch: branchFor(name),
        baseBranch: baseBranch.trim() || "main",
      });
      toast({ tone: "success", title: "Worktree created", description: workspace.name });
      onCreated(workspace);
      setName("");
      setBaseBranch("main");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="New worktree"
      description="Cut an isolated git worktree on a fresh branch."
      footer={
        projectId ? (
          <>
            <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="new-workspace-form"
              loading={busy}
              disabled={name.trim().length === 0}
            >
              Create worktree
            </Button>
          </>
        ) : null
      }
    >
      {projectId ? (
        <form id="new-workspace-form" onSubmit={submit} className="flex flex-col gap-3">
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            hint="Example: feat/login-rework"
            data-testid="new-workspace-name"
            autoFocus
          />
          <Input
            label="Base branch"
            value={baseBranch}
            onChange={(event) => setBaseBranch(event.currentTarget.value)}
            hint={name.trim().length > 0 ? `New branch: ${branchFor(name)}` : "Defaults to main"}
          />
          {error ? <p className="text-2xs text-error-fg">{error}</p> : null}
        </form>
      ) : (
        <EmptyState
          icon={<FolderGit2 />}
          title="No project loaded"
          description="Open a project (a git repository) first, then add worktrees to it."
        />
      )}
    </Dialog>
  );
}
