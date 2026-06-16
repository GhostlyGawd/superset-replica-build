import { cn } from "@swarm/ui";
import { Badge, CodeBlock, Tabs } from "@swarm/ui/react";
import { Apple, Download, GitBranch, Terminal as TerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Section } from "../components/Section";

type OS = "macos" | "linux" | "windows";

interface OsInfo {
  readonly os: OS;
  readonly label: string;
  readonly install: string;
  readonly artifact: string;
  /** Sample size — set at release. Labeled honest, not a real published number. */
  readonly size: string;
}

const OSES: readonly OsInfo[] = [
  {
    os: "macos",
    label: "macOS",
    install: "brew install grove\ngrove up",
    artifact: "Grove-1.0.0-arm64.dmg",
    size: "~ — sample, set at release",
  },
  {
    os: "linux",
    label: "Linux",
    install: "curl -fsSL https://grove.dev/install.sh | sh\ngrove up",
    artifact: "Grove-1.0.0-x86_64.AppImage",
    size: "~ — sample, set at release",
  },
  {
    os: "windows",
    label: "Windows",
    install: "winget install grove\ngrove up",
    artifact: "Grove-1.0.0-x64-setup.exe",
    size: "~ — sample, set at release",
  },
];

function detectOs(): OS {
  if (typeof navigator === "undefined") return "macos";
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") || ua.includes("android")) return "linux";
  return "macos";
}

export function Install() {
  // SSR default macOS (so no-JS is valid); refine to the real OS on hydration.
  const [os, setOs] = useState<OS>("macos");
  useEffect(() => {
    setOs(detectOs());
  }, []);

  const items = OSES.map((info) => ({
    value: info.os,
    label: info.label,
    icon: info.os === "macos" ? <Apple /> : <TerminalIcon />,
    content: <OsPanel info={info} />,
  }));

  return (
    <Section
      id="install"
      num="07"
      title="Install Grove"
      subhead="One command to a running cockpit. Self-hosted, open source, loopback by default — nothing leaves your machine. The phone PWA pairs from the running desktop over the in-app QR."
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="success" dot>
          self-hosted
        </Badge>
        <Badge tone="info">OSS · MIT</Badge>
        <Badge tone="neutral">embedded Postgres (PGlite) · no service to run</Badge>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-surface p-4">
        <Tabs items={items} value={os} onValueChange={(v) => setOs(v as OS)} />
      </div>

      <p className="mt-6 rounded-md border border-line-subtle bg-inset px-3 py-2 font-mono text-xs text-fg-muted">
        grove up — loopback, bearer-gated, embedded Postgres. Nothing leaves your machine.
      </p>
      <p className="mt-3 font-mono text-2xs text-fg-subtle">
        Install URLs and package managers are launch markers, named here ahead of the release
        channels going live.
      </p>
    </Section>
  );
}

function OsPanel({ info }: { readonly info: OsInfo }) {
  return (
    <div className="flex flex-col gap-4">
      <CodeBlock title={`${info.label} · shell`} code={info.install} />

      <div className="overflow-hidden rounded-lg border border-line">
        <DownloadRow
          icon={<Download className="size-4" aria-hidden />}
          primary={info.artifact}
          secondary={`signed installer · ${info.size}`}
        />
        <DownloadRow
          icon={<GitBranch className="size-4" aria-hidden />}
          primary="git clone github.com/GhostlyGawd/grove"
          secondary="build from source · cd grove && grove up"
          mono
        />
      </div>
    </div>
  );
}

function DownloadRow({
  icon,
  primary,
  secondary,
  mono = false,
}: {
  readonly icon: React.ReactNode;
  readonly primary: string;
  readonly secondary: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-subtle bg-raised px-3 py-2.5 last:border-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-subtle">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm text-fg", mono && "font-mono text-xs")}>{primary}</p>
        <p className="truncate font-mono text-2xs text-fg-subtle">{secondary}</p>
      </div>
      <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-fg-subtle">
        {mono ? "source" : "download"}
      </span>
    </div>
  );
}
