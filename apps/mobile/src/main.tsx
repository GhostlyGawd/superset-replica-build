import { ThemeProvider, ToastProvider } from "@swarm/ui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "@xterm/xterm/css/xterm.css";
import "./index.css";

// Register the offline service worker (ADR-0014 decision 6), built by
// `vite-plugin-pwa` (injectManifest) to `/sw.js`. `localhost`/`127.0.0.1` are secure
// contexts, so this lights up in dev + the phone-viewport e2e; on the LAN over plain
// HTTP the browser declines to register (Phase-5 closes that with TLS). The SW is a
// self-contained bundle, registered as a classic worker. Failure is non-fatal — the
// app works without it, only losing the offline shell + push.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
