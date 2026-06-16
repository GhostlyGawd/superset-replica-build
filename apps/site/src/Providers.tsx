import { ThemeProvider, ToastProvider } from "@swarm/ui/react";
import type { ReactNode } from "react";
import { ClockProvider, CockpitProvider } from "./store/cockpit";

/**
 * The provider stack, shared by the hydrating client entry and the build-time
 * prerender so SSR output and the hydrated tree match exactly. Order matters
 * only in that the cockpit store + shared clock must wrap every island that
 * reads them; Theme + Toast are independent.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <ClockProvider>
        <CockpitProvider>
          <ToastProvider>{children}</ToastProvider>
        </CockpitProvider>
      </ClockProvider>
    </ThemeProvider>
  );
}
