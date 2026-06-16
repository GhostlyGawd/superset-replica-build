import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import { Providers } from "./Providers";
import "./index.css";

/**
 * Client entry. The HTML already contains the real, prerendered section copy
 * (see scripts/prerender.mjs), so we HYDRATE rather than render — the
 * interactive islands wake over the static content with no flash and no
 * LCP-gating heavy island.
 */
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

hydrateRoot(
  container,
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
