import { cn } from "@swarm/ui";
import type { ReactNode } from "react";

/**
 * A documentary pane in the content well. Each carries the section number as a
 * mono kicker, a title, and an operator subhead — then the live surface. The
 * `id` is the scroll/focus anchor used by the palette + chevron. Panes are
 * separated by hairline borders (zero blur/shadow); nothing here animates on
 * load.
 */
export function Section({
  id,
  num,
  title,
  subhead,
  children,
  className,
  headingClassName,
}: {
  readonly id: string;
  readonly num: string;
  readonly title: ReactNode;
  readonly subhead?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Override the title element class — §00 uses the one 30px headline here. */
  readonly headingClassName?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "scroll-mt-10 border-b border-line px-4 py-10 focus-visible:outline-none sm:px-6 lg:px-10",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs tabular-nums text-fg-subtle">{num}</span>
          <span className="h-px flex-1 bg-line-subtle" aria-hidden />
        </div>
        <h2
          id={`${id}-title`}
          className={cn("mt-3 text-xl font-semibold tracking-tight text-fg", headingClassName)}
        >
          {title}
        </h2>
        {subhead ? <p className="mt-2 max-w-2xl text-sm text-fg-muted">{subhead}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}
