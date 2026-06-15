import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  IconButton,
  Spinner,
  Tooltip,
  useToast,
} from "@swarm/ui/react";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { chordFromEvent, formatChord, isModifierOnly } from "../shortcuts/chord.ts";
import { type HotkeyAction, type HotkeyScope, actionsForScope } from "../shortcuts/registry.ts";
import type { HotkeyController } from "../shortcuts/useHotkeys.ts";

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly controller: HotkeyController;
}

const SCOPE_LABEL: Record<HotkeyScope, string> = {
  shell: "Workspace & navigation",
  terminal: "Terminal",
};

/**
 * Settings (P09): customize keyboard shortcuts. Lists every registry action with
 * its current binding, captures a fresh keystroke to rebind, and resets to the
 * registry default — all persisted to the host via the `settings` router. Real
 * loading / error states keyed off the {@link HotkeyController}.
 */
export function SettingsDialog({ open, onOpenChange, controller }: SettingsDialogProps) {
  const { toast } = useToast();
  const { bindings, overrides, phase, error } = controller;
  const [capturing, setCapturing] = useState<string | null>(null);

  // While capturing, the next non-modifier keystroke becomes the new binding.
  useEffect(() => {
    if (!capturing) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setCapturing(null);
        return;
      }
      if (isModifierOnly(event)) {
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) {
        return;
      }
      const actionId = capturing;
      setCapturing(null);
      const conflict = Object.entries(bindings).find(
        ([id, value]) => id !== actionId && value === chord,
      );
      void controller
        .setBinding(actionId, chord)
        .then(() => {
          if (conflict) {
            toast({
              tone: "attention",
              title: "Shortcut reassigned",
              description: `${formatChord(chord)} was also bound to “${conflict[0]}”.`,
            });
          }
        })
        .catch((err: unknown) => {
          toast({
            tone: "error",
            title: "Couldn't save shortcut",
            description: err instanceof Error ? err.message : String(err),
          });
        });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, bindings, controller, toast]);

  // Cancel any in-flight capture whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setCapturing(null);
    }
  }, [open]);

  const reset = useCallback(
    (actionId: string) => {
      void controller.resetBinding(actionId).catch((err: unknown) => {
        toast({
          tone: "error",
          title: "Couldn't reset shortcut",
          description: err instanceof Error ? err.message : String(err),
        });
      });
    },
    [controller, toast],
  );

  const resetAll = useCallback(() => {
    void controller.resetAll().catch((err: unknown) => {
      toast({
        tone: "error",
        title: "Couldn't reset shortcuts",
        description: err instanceof Error ? err.message : String(err),
      });
    });
  }, [controller, toast]);

  const renderRow = (action: HotkeyAction) => {
    const isCapturing = capturing === action.id;
    const overridden = action.id in overrides;
    return (
      <div
        key={action.id}
        data-testid={`hotkey-row-${action.id}`}
        className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{action.label}</p>
          <p className="truncate text-2xs text-fg-subtle">{action.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {overridden ? <Badge tone="neutral">custom</Badge> : null}
          {isCapturing ? (
            <span
              className="font-mono text-2xs text-accent-fg"
              data-testid={`binding-${action.id}`}
            >
              Press keys… (Esc)
            </span>
          ) : (
            <code
              data-testid={`binding-${action.id}`}
              className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
            >
              {formatChord(bindings[action.id] ?? "")}
            </code>
          )}
          <Button
            size="sm"
            variant={isCapturing ? "primary" : "secondary"}
            aria-label={`Rebind ${action.label}`}
            onClick={() => setCapturing(isCapturing ? null : action.id)}
          >
            {isCapturing ? "Cancel" : "Rebind"}
          </Button>
          <Tooltip label="Reset to default">
            <IconButton
              size="sm"
              aria-label={`Reset ${action.label}`}
              disabled={!overridden}
              onClick={() => reset(action.id)}
            >
              <RotateCcw />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Customize the desktop's keyboard shortcuts. Changes are saved to the host."
      className="max-w-2xl"
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RotateCcw className="size-3.5" aria-hidden />}
            onClick={resetAll}
            disabled={phase !== "ready" || Object.keys(overrides).length === 0}
          >
            Reset all to defaults
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </>
      }
    >
      {phase === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-10 text-fg-muted">
          <Spinner label="Loading shortcuts" />
          <span className="text-xs">Loading shortcuts…</span>
        </div>
      ) : phase === "error" ? (
        <ErrorState
          title="Couldn't load shortcuts"
          description="The host's settings couldn't be read."
          detail={error ?? undefined}
          action={
            <Button size="sm" variant="secondary" onClick={controller.reload}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4" data-testid="settings-shortcuts">
          {(["shell", "terminal"] as const).map((scope) => (
            <section key={scope} className="flex flex-col gap-1.5">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                {SCOPE_LABEL[scope]}
              </h3>
              <div className="flex flex-col gap-1.5">{actionsForScope(scope).map(renderRow)}</div>
            </section>
          ))}
          <p className="text-2xs text-fg-subtle">
            Terminal preset slots <span className="font-mono">Ctrl+1</span>…
            <span className="font-mono">9</span> run command presets and aren't rebindable here.
          </p>
        </div>
      )}
    </Dialog>
  );
}
