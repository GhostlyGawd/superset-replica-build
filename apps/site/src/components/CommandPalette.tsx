import { cn } from "@swarm/ui";
import { Dialog } from "@swarm/ui/react";
import { CornerDownLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { emit, on } from "../lib/bus";
import { VERBS, focusSection } from "../lib/sections";
import { useDispatch } from "../store/cockpit";

/**
 * The command palette (⌘K / `/`) — a Dialog island listing the real product
 * verbs (up · ls · diff · status · harvest · pair · kill). Choosing a verb
 * scrolls/focuses its pane (keyboard-honest navigation), and a couple dispatch
 * a pull action (e.g. `up` replays the terminal). Opening it counts as the
 * first interaction, so the shell wakes. Built on the native-dialog Dialog, so
 * focus-trap + Escape come from the platform.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dispatch = useDispatch();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global open shortcuts: ⌘K / Ctrl-K, and `/` when not typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        dispatch({ type: "interact" });
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (k === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
        dispatch({ type: "interact" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dispatch]);

  // Let other surfaces (the Cmd-K hint in the rail) request the palette.
  useEffect(
    () =>
      on((event) => {
        if (event.type === "open-palette") {
          setOpen(true);
          dispatch({ type: "interact" });
        }
      }),
    [dispatch],
  );

  // Reset filter + selection each time it opens, and focus the field.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // The native dialog grabs focus; nudge it to the input next frame.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return VERBS;
    return VERBS.filter((v) => v.verb.includes(q) || v.hint.toLowerCase().includes(q));
  }, [query]);

  const run = (index: number) => {
    const v = results[index];
    if (!v) return;
    setOpen(false);
    dispatch({ type: "interact" });
    if (v.verb === "up") emit({ type: "replay-terminal" });
    if (v.verb === "harvest") emit({ type: "stage-harvest" });
    if (v.verb === "status") emit({ type: "simulate-notification" });
    // Let the dialog close before scrolling so focus lands on the pane.
    requestAnimationFrame(() => focusSection(v.target));
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Command palette" className="max-w-xl">
      <div className="flex flex-col gap-3">
        {/*
          WAI-ARIA combobox + listbox: focus stays in the input, arrow keys move
          aria-activedescendant over the option ids. Options are divs (not li) so
          they carry role=option without the non-interactive-element rule firing.
        */}
        <div className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              results[active] ? `${listId}-opt-${results[active].verb}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Type a command — up, ls, diff, status, harvest, pair, kill"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onListKey}
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 font-mono text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-overlay"
          />
          {query === "" ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 font-mono text-sm text-fg-subtle"
            >
              Type a command — up · ls · diff · status · harvest · pair · kill
            </span>
          ) : null}
        </div>
        <div
          id={listId}
          // tabIndex -1: listbox is reachable for AT but kept out of the tab order;
          // focus stays in the input and moves via aria-activedescendant.
          tabIndex={-1}
          // biome-ignore lint/a11y/useSemanticElements: no native listbox element exists; role=listbox is the correct ARIA for a combobox popup
          role="listbox"
          aria-label="Commands"
          className="flex flex-col gap-0.5"
        >
          {results.map((v, i) => (
            <div
              key={v.verb}
              id={`${listId}-opt-${v.verb}`}
              // biome-ignore lint/a11y/useSemanticElements: no native option element exists; role=option is the correct ARIA
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // Keep focus in the input; act on click without a focus jump.
                e.preventDefault();
                run(i);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-fast",
                i === active
                  ? "bg-accent-bg ring-1 ring-inset ring-accent-border"
                  : "hover:bg-raised",
              )}
            >
              <span className="w-16 shrink-0 font-mono text-sm font-medium text-fg">{v.verb}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{v.hint}</span>
              {i === active ? (
                <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
              ) : null}
            </div>
          ))}
          {results.length === 0 ? (
            <p className="px-2.5 py-3 text-xs text-fg-subtle">No matching command.</p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
