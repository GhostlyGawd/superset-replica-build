import { cn } from "@swarm/ui";
import { useId } from "react";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * A text-labeled segmented control (never icon-only — the label carries the
 * meaning). Built on real `<input type="radio">` elements (visually hidden,
 * label-wrapped) so keyboard + screen-reader behaviour comes from the platform.
 * Square-ish, hairline, on-token; the active segment gets a subtle raised
 * surface, not the brand accent (reserved for the one primary action). State
 * changes on click only.
 */
export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
}) {
  const name = useId();
  return (
    <fieldset className="inline-flex rounded-md border border-line-strong bg-base p-0.5">
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <label
            key={opt.value}
            className={cn(
              "cursor-pointer rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-fast ease-standard focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-1 focus-within:ring-offset-base",
              active ? "bg-raised text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        );
      })}
    </fieldset>
  );
}
