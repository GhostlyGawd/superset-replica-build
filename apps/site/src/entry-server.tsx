import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { Providers } from "./Providers";

/**
 * Build-time render. `scripts/prerender.mjs` imports this, renders the full app
 * to an HTML string, and injects it into the index template so `dist/index.html`
 * ships the real section copy (good unfurl / SEO / no-JS). No CSS import here —
 * the client bundle owns the stylesheet; this entry only produces markup.
 *
 * The app is written SSR-safe: every browser API (navigator, window, matchMedia,
 * clipboard, rAF) is read inside event handlers or effects, never during render,
 * and the shared clock returns a 0 server snapshot so timers render their
 * baseline and go live on hydration.
 */
export function render(): string {
  return renderToString(
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>,
  );
}
