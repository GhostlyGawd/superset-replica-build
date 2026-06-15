// Throwaway evidence tooling: capture full-page Playwright screenshots of the
// Grove showcase at desktop + phone, in dark + light themes.
// Not shipped code. Run via: PW_HOME=<temp playwright install> bun evidence/phase-1/_shots.mjs
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "screenshots");

// Resolve playwright from an isolated install so repo deps stay untouched.
const pwHome = process.env.PW_HOME;
if (!pwHome) throw new Error("PW_HOME env var (path to isolated playwright install) is required");
const req = createRequire(join(pwHome, "package.json"));
const entry = req.resolve("playwright");
const mod = await import(pathToFileURL(entry).href);
const chromium = mod.chromium ?? mod.default?.chromium;
if (!chromium) throw new Error("could not load chromium from playwright");

const baseUrl = process.env.BASE_URL ?? "http://localhost:4317/";

const targets = [
  { name: "desktop", width: 1440, height: 900, dsf: 1 },
  { name: "phone", width: 390, height: 844, dsf: 2 },
];
const themes = ["dark", "light"];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const t of targets) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: t.width, height: t.height },
        deviceScaleFactor: t.dsf,
      });
      // Seed the theme before any app script runs: the ThemeProvider reads
      // localStorage["grove-theme"] on its initial render.
      await context.addInitScript((value) => {
        window.localStorage.setItem("grove-theme", value);
        document.documentElement.setAttribute("data-theme", value);
      }, theme);

      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      // Confirm the attribute the app actually toggles landed.
      const applied = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(400);

      const file = join(outDir, `${t.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const dims = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
        vw: window.innerWidth,
      }));
      results.push({ file: `${t.name}-${theme}.png`, applied, ...dims });
      console.log(
        `captured ${t.name}-${theme}.png  theme=${applied}  content=${dims.w}x${dims.h}  innerW=${dims.vw}`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log("DONE", JSON.stringify(results));
