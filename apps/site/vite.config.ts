import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

// The launch site is prerendered to static HTML (ADR-0021): `vite build` emits
// the hydratable client bundle, `vite build --ssr src/entry-server.tsx` emits a
// Node-runnable render, and `scripts/prerender.mjs` stitches the real section
// copy into `dist/index.html`. No SSR framework dependency — the proven Vite +
// `@swarm/ui` toolchain only.
//
// Deploy base (ADR-0022): GitHub Pages serves a project site under a `/grove/`
// subpath, so every asset must resolve under that base or it 404s. `base` is
// env-configurable (`SITE_BASE`) so a later custom domain (base `/`) is a
// one-line change. Trailing slash required by Vite.
const BASE = process.env.SITE_BASE ?? "/grove/";

export default defineConfig({
  base: BASE,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
});
