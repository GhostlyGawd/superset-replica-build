import type { Workspace } from "@swarm/db";
import { Button, Dialog, Input, useToast } from "@swarm/ui/react";
import { type FormEvent, useState } from "react";
import type { HostTrpcClient } from "../../host-client.ts";

interface OpenProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly client: HostTrpcClient | null;
  readonly onOpened: (workspace: Workspace) => void;
}

/**
 * Open an existing git repository on the host as a project (P08). The host
 * validates that the path is a REAL git working tree before registering it and
 * seeding a first worktree from its current branch. Real submitting/error states;
 * a non-repo path surfaces the host's validation error inline.
 */
export function OpenProjectDialog({
  open,
  onOpenChange,
  client,
  onOpened,
}: OpenProjectDialogProps) {
  const { toast } = useToast();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (busy) {
      return;
    }
    if (!next) {
      setPath("");
      setName("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || path.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await client.projects.open.mutate({
        path: path.trim(),
        name: name.trim() || undefined,
      });
      toast({
        tone: "success",
        title: "Project opened",
        description: `${result.project.name} · ${result.workspace.name}`,
      });
      onOpened(result.workspace);
      setPath("");
      setName("");
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
      title="Open project"
      description="Point Grove at a git repository on the host to start working in it."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="open-project-form"
            loading={busy}
            disabled={path.trim().length === 0}
          >
            Open project
          </Button>
        </>
      }
    >
      <form id="open-project-form" onSubmit={submit} className="flex flex-col gap-3">
        <Input
          label="Repository path"
          value={path}
          onChange={(event) => setPath(event.currentTarget.value)}
          hint="Example: C:\\src\\my-repo  or  /home/me/my-repo"
          data-testid="open-project-path"
          autoFocus
        />
        <Input
          label="Worktree name (optional)"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          hint="Defaults to the repo folder name"
        />
        {error ? <p className="text-2xs text-error-fg">{error}</p> : null}
      </form>
    </Dialog>
  );
}
