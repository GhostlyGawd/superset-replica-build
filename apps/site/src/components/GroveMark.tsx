import { cn } from "@swarm/ui";
import { AgentStatusDot } from "@swarm/ui/react";
import { useInteracted } from "../store/cockpit";

/**
 * The brand mark: a trunk forking into three shoots, each tipped with a filled
 * node. The three nodes ARE the product `AgentStatusDot` (running tone) — and,
 * per the MOTION LAW, they are STILL until the visitor acts: the running pulse
 * is suppressed via the wrapper until the cockpit store reports the first
 * interaction, then the real dot animation runs. The SVG carries only the
 * inert trunk/branch strokes; the live nodes sit at the shoot tips.
 */
export function GroveMark({
  size = 16,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) {
  const interacted = useInteracted();
  const px = `${size}px`;

  return (
    <span
      className={cn(
        "relative inline-block shrink-0 text-accent-fg",
        // Until the first interaction, freeze the node pulse (MOTION LAW). The
        // dots stay filled + legible; only the ambient animation is held.
        !interacted && "[&_.grove-pulse]:!animate-none",
        className,
      )}
      style={{ width: px, height: px }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="absolute inset-0 size-full"
        focusable="false"
        role="img"
        aria-label="Grove"
      >
        <title>Grove</title>
        <path
          d="M12 23V13M12 14.5L6 9M12 13.5L12 6M12 14.5L18 9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      {/* Three shoot-tip nodes — real AgentStatusDots, positioned over the strokes. */}
      <span className="absolute left-[18%] top-[30%] -translate-x-1/2 -translate-y-1/2">
        <AgentStatusDot status="running" size="sm" />
      </span>
      <span className="absolute left-1/2 top-[18%] -translate-x-1/2 -translate-y-1/2">
        <AgentStatusDot status="running" size="sm" />
      </span>
      <span className="absolute left-[82%] top-[30%] -translate-x-1/2 -translate-y-1/2">
        <AgentStatusDot status="running" size="sm" />
      </span>
    </span>
  );
}
