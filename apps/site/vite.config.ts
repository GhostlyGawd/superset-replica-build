import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

// The launch site is prerendered to static HTML (ADR-0021): `vite build` emits
// the hydratable client bundle, `vite build --ssr src/entry-server.tsx` emits a
// Node-runnable render, and `scripts/prerender.mjs` stitches the real section
// copy into `dist/index.html`. No SSR framework dependency — the proven Vite +
// `@swarm/ui` toolchain only.
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
});
