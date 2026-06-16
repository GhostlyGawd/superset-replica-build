// Build-time prerender (ADR-0021): stitch the real, server-rendered section
// copy into the Vite client HTML so dist/index.html ships a complete page, not
// a blank SPA shell. Runs after `vite build` (client) and `vite build --ssr`.
//
// No SSR framework — just react-dom/server via the SSR bundle. The client
// bundle's <script>/<link> tags (already in dist/index.html) drive hydration.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distHtml = resolve(root, "dist/index.html");
const ssrEntry = resolve(root, "dist/server/entry-server.js");

const template = readFileSync(distHtml, "utf8");

const { render } = await import(pathToFileURL(ssrEntry).href);
const appHtml = render();

if (!template.includes("<!--app-html-->")) {
  throw new Error("prerender: marker <!--app-html--> missing from dist/index.html");
}

const out = template.replace("<!--app-html-->", appHtml);

// Sanity: the rendered copy must actually be present (fail the build otherwise,
// so a regression to a blank shell can never ship).
const PROOF = "Keep one calm surface";
if (!out.includes(PROOF)) {
  throw new Error(`prerender: expected real copy ${JSON.stringify(PROOF)} not found in output`);
}

writeFileSync(distHtml, out, "utf8");

const kb = (out.length / 1024).toFixed(1);
console.log(`prerender: wrote dist/index.html with real copy (${kb} kB)`);
