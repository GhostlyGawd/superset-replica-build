import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { cn } from "../cn";
import { IconButton } from "./IconButton";

export type DialogVariant = "center" | "sheet";
export type SheetSide = "right" | "left";

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly variant?: DialogVariant;
  readonly side?: SheetSide;
  readonly className?: string;
}

const CENTER =
  "fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-lg rounded-lg grove-anim-dialog";
const SHEET_RIGHT =
  "fixed inset-y-0 right-0 m-0 h-full w-full max-w-md rounded-none grove-anim-toast";
const SHEET_LEFT =
  "fixed inset-y-0 left-0 m-0 h-full w-full max-w-md rounded-none grove-anim-toast";

/**
 * Modal dialog built on the native `<dialog>` element: real focus trapping,
 * Escape-to-close, inert background, and a `::backdrop` come for free from the
 * platform. `variant="sheet"` docks it to a screen edge (used on phone widths).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = "center",
  side = "right",
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  // useLayoutEffect (not useEffect) so showModal()/close() runs synchronously before
  // paint — the native dialog enters/leaves the top layer in the same frame as the
  // `flex`/`hidden` class flips below, killing the one-frame open-flash. Client-only
  // app (Electron renderer + Vite SPA), so there is no SSR useLayoutEffect warning.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  const shape = variant === "sheet" ? (side === "left" ? SHEET_LEFT : SHEET_RIGHT) : CENTER;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={() => onOpenChange(false)}
      className={cn(
        // A closed <dialog> must stay display:none (the UA default) so an always-mounted,
        // closed Dialog/Sheet does not paint full-bleed and steal input. Emitting `flex`
        // unconditionally overrode that; gate it on `open` so closed → `hidden`
        // (display:none) wins and open → `flex` lays out the column.
        open ? "flex" : "hidden",
        "max-h-[calc(100dvh-2rem)] flex-col border border-line-strong bg-overlay text-fg shadow-lg",
        variant === "sheet" && "max-h-none",
        shape,
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton aria-label="Close dialog" size="sm" onClick={() => onOpenChange(false)}>
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-sm text-fg-muted">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </dialog>
  );
}

export type SheetProps = Omit<DialogProps, "variant">;

/** A Dialog docked to a screen edge — the phone-friendly modal surface. */
export function Sheet(props: SheetProps) {
  return <Dialog {...props} variant="sheet" />;
}
