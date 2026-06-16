import { CockpitShell } from "./components/CockpitShell";
import { CommandPalette } from "./components/CommandPalette";
import { ColdOpen } from "./sections/ColdOpen";
import { Harvest } from "./sections/Harvest";
import { Install } from "./sections/Install";
import { Isolation } from "./sections/Isolation";
import { Monitoring } from "./sections/Monitoring";
import { Phone } from "./sections/Phone";
import { SwarmDial } from "./sections/SwarmDial";
import { Terminal } from "./sections/Terminal";
import { useMountEpoch } from "./store/cockpit";

/**
 * The launch site as a working instance of the Grove cockpit. The persistent
 * shell stays pinned; the documentary sections scroll through the content well.
 * Section copy is real and prerendered (ADR-0021); interactive demos hydrate as
 * islands over it.
 */
export function App() {
  // Record one shared mount epoch so every elapsed timer shares an origin.
  useMountEpoch();
  return (
    <CockpitShell>
      <ColdOpen />
      <SwarmDial />
      <Isolation />
      <Terminal />
      <Harvest />
      <Monitoring />
      <Phone />
      <Install />
      <SiteFooter />
      <CommandPalette />
    </CockpitShell>
  );
}

function SiteFooter() {
  return (
    <footer className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 font-mono text-2xs text-fg-subtle">
        <p>
          grove · @swarm/ui · IBM Plex Sans + Mono (OFL) · Lucide (ISC) · self-hosted · OSS (MIT)
        </p>
        <p>Mission control for a swarm of CLI coding agents — calm surface, swarming depth.</p>
      </div>
    </footer>
  );
}
