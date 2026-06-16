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
const distDir = resolve(root, "dist");
const distHtml = resolve(distDir, "index.html");
const ssrEntry = resolve(distDir, "server/entry-server.js");

// Deploy identity (ADR-0022). `base` is the asset path prefix Vite already
// stamped onto every URL (`/grove/`); `SITE_URL` is the canonical absolute
// origin+base used for social-unfurl tags (og:image, og:url, canonical) — those
// MUST be fully-qualified, never root-relative, or Slack/Twitter/Facebook can't
// resolve the card. Both env-configurable so a custom domain is a one-line change
// (`SITE_BASE=/ SITE_URL=https://grove.dev/`).
const base = process.env.SITE_BASE ?? "/grove/";
const siteUrl = process.env.SITE_URL ?? "https://ghostlygawd.github.io/grove/";
const absImage = new URL("og-cockpit.png", siteUrl).href;

const template = readFileSync(distHtml, "utf8");

const { render } = await import(pathToFileURL(ssrEntry).href);
const appHtml = render();

if (!template.includes("<!--app-html-->")) {
  throw new Error("prerender: marker <!--app-html--> missing from dist/index.html");
}

let out = template.replace("<!--app-html-->", appHtml);

// Absolute-ize the social card image. Vite rebased the source `/og-cockpit.png`
// to `${base}og-cockpit.png` (root-relative) — correct for the live page, but
// unfurl crawlers need the full origin. Rewrite both og:image and twitter:image.
const relImage = `${base}og-cockpit.png`;
if (!out.includes(relImage)) {
  throw new Error(`prerender: expected rebased image path ${relImage} not found (base wrong?)`);
}
out = out.split(relImage).join(absImage);

// Inject the canonical URL + og:url (good unfurl + SEO hygiene) right after the
// <title>, once. Absolute, from SITE_URL.
const canonicalTags = `\n    <link rel="canonical" href="${siteUrl}" />\n    <meta property="og:url" content="${siteUrl}" />`;
if (!out.includes('rel="canonical"')) {
  out = out.replace("</title>", `</title>${canonicalTags}`);
}

// Sanity: the rendered copy must actually be present (fail the build otherwise,
// so a regression to a blank shell can never ship), and the absolute card URL
// must have landed.
const PROOF = "Keep one calm surface";
if (!out.includes(PROOF)) {
  throw new Error(`prerender: expected real copy ${JSON.stringify(PROOF)} not found in output`);
}
if (!out.includes(absImage)) {
  throw new Error(`prerender: expected absolute og:image ${absImage} not found in output`);
}

writeFileSync(distHtml, out, "utf8");

// `.nojekyll` tells GitHub Pages to serve the tree verbatim (no Jekyll pass that
// would strip `_`-prefixed paths). Harmless everywhere else.
writeFileSync(resolve(distDir, ".nojekyll"), "", "utf8");

const kb = (out.length / 1024).toFixed(1);
console.log(
  `prerender: wrote dist/index.html with real copy (${kb} kB) + .nojekyll; og:image=${absImage}`,
);
