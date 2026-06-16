/**
 * A tiny client-only event bus for cross-island pull actions that aren't store
 * state — e.g. the command palette's `up` verb asking the terminal island to
 * replay its recorded session, or `harvest` nudging the diff pane to stage. No
 * autoplay: these only fire from an explicit user action (palette / click).
 */
export type BusEvent =
  | { readonly type: "replay-terminal" }
  | { readonly type: "open-palette" }
  | { readonly type: "stage-harvest" }
  | { readonly type: "simulate-notification" };

type Handler = (event: BusEvent) => void;

const handlers = new Set<Handler>();

export function emit(event: BusEvent) {
  for (const h of handlers) h(event);
}

export function on(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
