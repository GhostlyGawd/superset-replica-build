# Grove desktop packaging

Cross-platform installers for the Grove desktop app, built with
[`electron-builder`](https://www.electron.build/) (ADR-0005, ADR-0016).

## Targets

| OS      | Target        | Icon              |
| ------- | ------------- | ----------------- |
| Windows | NSIS `.exe`   | `build/icon.ico`  |
| macOS   | `dmg` + `zip` | `build/icon.icns` |
| Linux   | AppImage + deb | `build/icons/`   |

- `appId`: `sh.grove.desktop` · `productName`: `Grove`
- Output: `apps/desktop/release/` (gitignored)
- Build resources (committed icons): `apps/desktop/build/`

## Scripts

```sh
# regenerate the platform icons from the brand mark (docs/brand/assets/grove-mark.svg)
bun run build:icons      # -> build/icon.ico, build/icon.icns, build/icon.png, build/icons/<n>x<n>.png

# unpacked app, no installer, no GUI launch — validates the packaging config (W5 CI runs this)
bun run package:dir      # bun run build && electron-builder --dir

# full platform installers (local evidence, W6)
bun run build:installer  # bun run build && electron-builder
```

`bun run build` first emits the self-contained bundles `electron-builder` packages:
`dist/main.js`, `dist/preload.cjs`, and `dist/renderer/**`. Nothing is required from
`node_modules` at runtime except Electron itself, so the package ships `dist/` +
`package.json` only (see `files` in `electron-builder.yml`).

## CI vs. local evidence (ADR-0016)

- **CI (W5)** runs `electron-builder --dir` on all three OSes — an *unpacked* app, no
  installer and no GUI launch. CI is headless and cannot assert a window, so the package
  job only proves the packaging config is cold-buildable (it unsets
  `ELECTRON_SKIP_BINARY_DOWNLOAD` for that job so the Electron binary downloads).
- **Local (W6)** produces the real installers (`.exe` / `.dmg` / `.AppImage` / `.deb`) and
  a human-launched GUI screenshot/trace under `evidence/phase-5/`.

## Unsigned binaries — SmartScreen / Gatekeeper

These builds are **unsigned** (no paid code-signing certificates; ADR-0005). Expect:

- **Windows (SmartScreen):** "Windows protected your PC" on first run of the NSIS
  installer. Click **More info → Run anyway**. The reputation prompt fades as the
  (unsigned) binary is downloaded by more users; a real fix needs an EV/OV cert.
- **macOS (Gatekeeper):** the `.dmg`/`.app` is neither signed nor notarized, so macOS
  shows "Grove can't be opened because it is from an unidentified developer." Right-click
  the app → **Open**, or `System Settings → Privacy & Security → Open Anyway`. The config
  sets `mac.identity: null` and `mac.notarize: false` — no certificate env is referenced.
- **Linux:** AppImage/deb are unaffected (no OS signature gate); for AppImage,
  `chmod +x Grove-*.AppImage` then run.

Signing is intentionally deferred until certificates are available; the config is
structured so adding `win.certificateFile` / a mac Developer ID later requires no
restructuring.
