// Phase-5 W6 LOCAL evidence — launch the REAL packaged Grove.exe and screenshot it.
//
// This proves the PACKAGED Windows app (electron-builder NSIS `win-unpacked/Grove.exe`,
// renderer loaded from inside app.asar — NOT the vite dev server) actually launches and
// renders the cockpit chrome on a GUI-capable Windows host. It closes parity P14 beyond
// the green `windows-latest` CI `--dir` packaging job (ADR-0016: a real GUI launch can't
// be asserted in headless CI; it is local human-launched evidence).
//
// Uses Playwright's Electron support (the existing @playwright/test install exports
// `_electron`). We launch the packaged executable directly, wait for the renderer to
// paint the shell (the `status-bar`/`app-titlebar` testids the e2e suite already keys
// on), screenshot the rendered window, and also record the real window title + bounds
// read from the Electron MAIN process — independent proof the BrowserWindow is live.
//
// Run:  node apps/desktop/scripts/capture-launch.mjs
// (with no host running, the renderer renders its real "No host running" connect state —
//  a deterministic first paint, not a crash.)
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");

const exePath = join(desktopRoot, "release", "win-unpacked", "Grove.exe");
const outDir = join(repoRoot, "evidence", "phase-5");
const outPng = join(outDir, "desktop-packaged-launch.png");

mkdirSync(outDir, { recursive: true });

console.log(`launching packaged app: ${exePath}`);
const app = await electron.launch({
  executablePath: exePath,
  // The packaged main reads the host manifest itself; no dev env. A clean launch with no
  // host yields the real connect state.
  timeout: 60_000,
});

try {
  // Window metadata straight from the Electron main process (BrowserWindow is real).
  const meta = await app.evaluate(async ({ BrowserWindow, app: electronApp }) => {
    const win = BrowserWindow.getAllWindows()[0];
    // Ensure it is actually shown (main gates show on ready-to-show; force it for the shot).
    if (win && !win.isVisible()) win.show();
    return {
      name: electronApp.getName(),
      version: electronApp.getVersion(),
      windowCount: BrowserWindow.getAllWindows().length,
      title: win?.getTitle() ?? null,
      bounds: win?.getBounds() ?? null,
      visible: win?.isVisible() ?? false,
    };
  });
  console.log("main-process window metadata:", JSON.stringify(meta, null, 2));

  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");

  // Wait for the renderer to actually paint the cockpit chrome (real React mount, not a
  // blank window): the status bar + titlebar the shell e2e already asserts on.
  await win.waitForSelector('[data-testid="status-bar"]', { timeout: 45_000 });
  await win.waitForSelector('[data-testid="app-titlebar"]', { timeout: 45_000 });
  const titlebarText = await win.getByTestId("app-titlebar").innerText();
  console.log(`rendered titlebar text: ${JSON.stringify(titlebarText)}`);

  // Small settle for webfonts/layout, then capture the rendered window.
  await win.waitForTimeout(1200);
  await win.screenshot({ path: outPng });
  console.log(`screenshot written: ${outPng}`);
} finally {
  await app.close();
  console.log("app closed");
}
