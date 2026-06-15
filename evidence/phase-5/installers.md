# Phase-5 W6 — Windows installer (electron-builder, real local build)

_Implements ADR-0016 (electron-builder packaging; CI validates `--dir`, full installers are
LOCAL evidence). Closes parity **P14** (native Windows, packaged) together with
`desktop-packaged-launch.png`._

## What was built
A real `bun run --filter @swarm/desktop build:installer` on this Windows 10 host
(10.0.19045, x64; bun 1.3.14, node 24). The script first `bun run build`s the renderer
(vite) + the bundled `main.js`/`preload.cjs` (bun build), then electron-builder downloaded
the Electron 42 binary and produced the NSIS installer plus the unpacked app tree.

- **electron-builder:** 26.15.3
- **Electron:** 42.4.0 (downloaded + extracted during the build — not pre-present locally;
  the W4/W5 config kept `ELECTRON_SKIP_BINARY_DOWNLOAD` so nothing was fetched until now)
- **appId / productName:** `sh.grove.desktop` / `Grove`
- **target:** NSIS (`oneClick:false, perMachine:false, allowToChangeInstallationDirectory:true`)
- **output dir:** `apps/desktop/release/` (gitignored — binaries are NOT committed)

## Real artifacts produced (`ls apps/desktop/release/`)

| Artifact | Path | Bytes | ~Size |
| --- | --- | --- | --- |
| NSIS installer | `apps/desktop/release/Grove Setup 0.1.0.exe` | 102,369,542 | 97.6 MiB |
| Installer block map | `apps/desktop/release/Grove Setup 0.1.0.exe.blockmap` | 107,162 | 105 KiB |
| Unpacked app launcher | `apps/desktop/release/win-unpacked/Grove.exe` | 232,266,752 | 221.5 MiB |
| Packed app archive | `apps/desktop/release/win-unpacked/resources/app.asar` | 1,406,533 | 1.34 MiB |
| Unpacked app tree (total) | `apps/desktop/release/win-unpacked/` | 372,625,619 (75 files) | 355 MiB |

**Unpacked app path:** `apps/desktop/release/win-unpacked/` (run `Grove.exe` directly, or
install via the NSIS `Grove Setup 0.1.0.exe`).

### app.asar integrity (`scripts/assert-unpacked.mjs`)
The same dependency-free assertion the CI `package` job runs passed against this real build:
`app.asar` is 1374 KiB and its header lists the bundled `main.js`, `preload.cjs`, and
renderer `index.html` — the self-contained bundle (ADR-0016: no `node_modules` shipped) is
genuinely packed in, and `win-unpacked/Grove.exe` is the located launcher.

## Signing / SmartScreen (unsigned by design — ADR-0016)
No paid code-signing certificate is configured (`mac.identity:null`, no win cert env), so
both `Grove Setup 0.1.0.exe` and `win-unpacked/Grove.exe` are **`NotSigned`** (verified via
`Get-AuthenticodeSignature`). Windows SmartScreen / Defender will therefore show the
unknown-publisher prompt on first run ("More info → Run anyway"). This is documented in
`apps/desktop/PACKAGING.md` and is the expected OSS-only behavior.

## macOS dmg + Linux AppImage/deb
These targets **cannot be built on Windows** (dmg needs macOS tooling; AppImage/deb need
Linux). They are produced on their own OS from the same `electron-builder.yml`. The
packaging config for all three targets is already validated cross-OS by the CI `package`
job, which runs `electron-builder --dir` (the unpacked app, no installer, no GUI launch) on
`windows-latest` + `macos-latest` + `ubuntu-latest` and asserts the app tree via
`assert-unpacked.mjs` (ADR-0016 W5). This W6 local build is the real Windows installer + GUI
launch that headless CI deliberately does not claim.

## Reproduce
```
bun run --filter @swarm/desktop build:installer
ls -la apps/desktop/release/
node apps/desktop/scripts/assert-unpacked.mjs   # (run from apps/desktop)
```
