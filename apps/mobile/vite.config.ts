import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Mobile PWA renderer build. Served same-origin by the Grove host (ADR-0014), so
 * asset URLs are root-absolute (`base: "/"`, the default). `public/` carries the
 * web app manifest + icon set, which Vite copies verbatim into `dist/`.
 *
 * `vite-plugin-pwa` (injectManifest, ADR-0014 decision 6) compiles the custom
 * service worker at `src/sw.ts` to `dist/sw.js`, injecting the app-shell precache
 * manifest. We keep the hand-authored `public/manifest.webmanifest` (already linked
 * from `index.html`), so the plugin generates no manifest of its own. Registration
 * is done manually from `main.tsx` via `virtual:pwa-register`.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // We ship our own manifest + register manually, so the plugin only builds the SW.
      manifest: false,
      injectRegister: false,
      injectManifest: {
        // App-shell ONLY (HTML/CSS/JS/icons/manifest); the API surface is never cached.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}"],
      },
      devOptions: {
        // The e2e serves the real production build, so dev-mode SW is unnecessary.
        enabled: false,
      },
    }),
  ],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
});
