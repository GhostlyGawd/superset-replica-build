import type { ChangeType } from "@swarm/db";
import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "../cn";
import { Badge } from "./Badge";
import type { BadgeTone } from "./Badge";
import { IconButton } from "./IconButton";

export type DiffLineType = "context" | "add" | "remove" | "hunk";

export interface DiffLine {
  readonly type: DiffLineType;
  readonly oldNumber?: number;
  readonly newNumber?: number;
  readonly text: string;
}

export interface DiffViewProps {
  readonly path: string;
  readonly changeType: ChangeType;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: readonly DiffLine[];
  readonly actions?: ReactNode;
  readonly className?: string;
}

const CHANGE_TONE: Record<ChangeType, BadgeTone> = {
  added: "success",
  modified: "attention",
  deleted: "error",
  renamed: "info",
};

const ROW: Record<DiffLineType, string> = {
  context: "",
  add: "bg-diff-add-bg",
  remove: "bg-diff-remove-bg",
  hunk: "",
};

const GUTTER: Record<DiffLineType, string> = {
  context: "text-fg-subtle",
  add: "bg-diff-add-gutter text-fg-muted",
  remove: "bg-diff-remove-gutter text-fg-muted",
  hunk: "text-fg-subtle",
};

const SIGN: Record<DiffLineType, { char: string; tone: string }> = {
  context: { char: " ", tone: "text-fg-subtle" },
  add: { char: "+", tone: "text-diff-add" },
  remove: { char: "-", tone: "text-diff-remove" },
  hunk: { char: " ", tone: "text-fg-subtle" },
};

/** Chrome for an inline diff: file header with change stats, then gutter + hunk body. */
export function DiffView({
  path,
  changeType,
  additions,
  deletions,
  lines,
  actions,
  className,
}: DiffViewProps) {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1] ?? path;
  const dir = segments.slice(0, -1).join("/");

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-sm",
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
          {dir ? <span className="truncate text-fg-subtle">{dir}/</span> : null}
          <span className="shrink-0 font-medium text-fg">{fileName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-2xs tabular-nums">
            <span className="text-diff-add">+{additions}</span>
            <span className="text-diff-remove">-{deletions}</span>
          </span>
          <Badge tone={CHANGE_TONE[changeType]}>{changeType}</Badge>
          {actions}
        </div>
      </header>

      {/* The diff body can overflow on narrow viewports; make it keyboard-
          focusable so it can be scrolled without a pointer (axe
          scrollable-region-focusable). */}
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable so it can be scrolled by keyboard
        tabIndex={0}
        aria-label={`Diff: ${fileName}`}
        className="min-h-0 flex-1 overflow-auto bg-inset font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        {lines.map((line, index) => {
          if (line.type === "hunk") {
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are a fixed, ordered snapshot
                key={index}
                className="bg-raised px-3 py-0.5 text-fg-subtle"
              >
                {line.text}
              </div>
            );
          }
          const sign = SIGN[line.type];
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are a fixed, ordered snapshot
              key={index}
              className={cn("grid grid-cols-[3rem_3rem_1fr]", ROW[line.type])}
            >
              <span className={cn("select-none px-2 text-right tabular-nums", GUTTER[line.type])}>
                {line.oldNumber ?? ""}
              </span>
              <span className={cn("select-none px-2 text-right tabular-nums", GUTTER[line.type])}>
                {line.newNumber ?? ""}
              </span>
              <code className="whitespace-pre px-2 text-fg">
                <span className={cn("select-none", sign.tone)}>{sign.char} </span>
                {line.text}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface CodeBlockProps {
  readonly code: string;
  /** Filename or language label shown in the header. */
  readonly title?: string;
  readonly className?: string;
}

/** A standalone code surface with a copy affordance — for config + snippet display. */
export function CodeBlock({ code, title, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-surface", className)}>
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="font-mono text-2xs text-fg-subtle">{title ?? "snippet"}</span>
        <IconButton aria-label={copied ? "Copied" : "Copy code"} size="sm" onClick={copy}>
          {copied ? <Check className="text-success-fg" /> : <Copy />}
        </IconButton>
      </div>
      {/* Keyboard-focusable scroll region so long snippets are scrollable
          without a pointer on narrow viewports (axe scrollable-region-focusable). */}
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable so it can be scrolled by keyboard
        tabIndex={0}
        aria-label={title ? `Code: ${title}` : "Code snippet"}
        className="overflow-auto bg-inset p-3 font-mono text-xs leading-relaxed text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
