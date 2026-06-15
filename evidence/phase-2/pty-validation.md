# Phase 2 — node-pty / ConPTY validation gate (ADR-0007)

**Date:** 2026-06-14 · **Host:** Windows 10 Home build 19045 (x64) · **Result:** GATE PASSED — PTY layer is viable on Windows. Chosen package wired into `packages/pty-supervisor`; repo green locally.

Toolchain: Node **v24.14.1**, Bun **1.3.14**, npm 11.11.0, Python 3.12.10 present, **no `cl.exe` / VS Build Tools on PATH** (so any node-gyp compile on this host would fail — a useful forcing function: it proves we are loading *prebuilt* binaries, not compiling).

---

## 1. Did node-pty load on Node 24 / Windows? — YES (prebuilt, no compile)

`npm i node-pty@latest` resolved **node-pty 1.1.0** (N-API via `node-addon-api ^7.1.0`). Its install step is `node scripts/prebuild.js || node-gyp rebuild`; `prebuild.js` only **checks** for a bundled prebuild and exits 0 if found, else falls back to `node-gyp rebuild`.

- Install ran `scripts/prebuild.js` → `{ code: 0 }`. **No node-gyp fallback** (it would have failed — no compiler).
- The tarball **bundles** prebuilt binaries in `prebuilds/<platform>-<arch>/`:
  - `win32-x64` (conpty.node, pty.node, conpty_console_list.node, winpty-agent.exe), `win32-arm64`, `darwin-x64`, `darwin-arm64`.
  - **No `linux-*` directory.** On Linux, `prebuild.js` exits 1 → `node-gyp rebuild` (compile required).
- **ABI:** node-addon-api 7 = N-API (ABI-stable). The Windows/macOS prebuilds load on Node 24 with no rebuild — confirmed below. So the ADR-0007 worry ("Node 24 prebuilds may not exist") is **moot for node-pty on Windows/macOS**; the binary is N-API and version-independent.

**Runtime loader** (`lib/utils.js`) requires the `.node` straight from `build/Release` or `prebuilds/<plat>-<arch>/` — no install script is needed to *place* the binary, only to compile when a prebuild is absent.

### PTY spawn + stream + resize + tree-kill proof (node-pty 1.1.0, under Node 24) — PASS
Probe spawned PowerShell and cmd PTYs, wrote `echo grove-pty-ok`, captured the stream, called `resize(120,40)`, then `tree-kill(pid,'SIGKILL')`, then verified PIDs via `tasklist`:

```
PowerShell: PASS (token=true ansi=true rootGone=true childGone=true)   # grandchild pid 22844 alive before kill, gone after
cmd:        PASS (token=true ansi=true rootGone=true childGone=true)
```
ANSI/VT confirmed in the raw stream, e.g.:
```
...<ESC>[1;77H<ESC>[?25h<ESC>[93mWrite-Host<ESC>[m <ESC>[36m'grove-pty-ok'<ESC>[m; ...
```

### BLOCKER discovered — node-pty does NOT run under Bun on Windows
This is the decisive finding and is **not in ADR-0007**. node-pty *loads* under Bun (`typeof spawn === "function"`) but throws on first write:
```
error: Socket is closed   code: "ERR_SOCKET_CLOSED"
  at _write (node:net:890:39)
  at .../node-pty/lib/windowsTerminal.js:147
```
node-pty's Windows ConPTY path streams data over a `net.Socket`-wrapped named pipe; Bun's `net` layer tears that socket down. **Confirmed identical failure for both candidate packages** → it is a Bun/ConPTY limitation, not package-specific. **Consequence:** the PTY layer must run under **Node**, never Bun, on Windows.

---

## 2. Fallback evaluation — prebuilds for win32-x64 / darwin / linux?

| | node-pty **1.1.0** (official) | **@homebridge/node-pty-prebuilt-multiarch 0.13.1** | node-pty-prebuilt-multiarch 0.10.1-pre.5 |
|---|---|---|---|
| Base | modern, N-API (node-addon-api 7), actively maintained | fork of node-pty 0.x; broad ABI prebuild matrix | older daviwil fork, pre-release, less maintained |
| win32-x64 prebuild | **bundled in tarball** (offline) | **downloaded** by `prebuild-install` → `build/Release` (verified: loads on Node 24) | download |
| darwin prebuild | bundled (x64+arm64) | downloaded (per release matrix; not runnable to verify on this Win host) | download |
| linux-x64 prebuild | **MISSING → node-gyp compile** | **bundled in tarball** (`node.abi102…abi137`, incl. `.musl` for Alpine; abi137 = Node 24) | download |
| Install needs a compiler? | **Yes on Linux** | **No on any OS** (with trustedDependencies) | No |
| Loads on Node 24 / Win | ✅ verified | ✅ verified | not tested |
| Runs under Bun on Win | ❌ ERR_SOCKET_CLOSED | ❌ ERR_SOCKET_CLOSED | (same lineage → expect ❌) |

Key Bun nuance: **Bun skips package lifecycle (install/postinstall) scripts unless the package is in root `trustedDependencies`.**
- node-pty: win/mac prebuilds are *bundled in the tarball* → resolvable with **no** script (Bun-install-safe on win/mac). Linux needs `node-gyp rebuild`, which under Bun also needs `node-gyp` on PATH (not guaranteed) — **fragile**.
- homebridge multiarch: linux prebuild is bundled (script-free); win/mac are *downloaded* by `prebuild-install` → needs `trustedDependencies` so Bun runs the download. **Verified:** `bun install` + `trustedDependencies` fetched the Windows prebuild into `build/Release` and it works under Node.

### PTY proof for homebridge multiarch (under Node 24) — PASS
```
PowerShell: PASS  rootPid=24956 childPid=10756 childAliveBefore=true rootGone=true childGone=true
cmd:        PASS  rootPid=28696 token=true ansi=true rootGone=true childGone=true
```

---

## 3. Final recommendation

**Package: `@homebridge/node-pty-prebuilt-multiarch@0.13.1`.**
It is the only candidate that **installs with prebuilds on all three CI runners with no compiler** (linux bundled; win/mac downloaded), which is exactly what this Bun-based, 3-OS CI needs. Official node-pty 1.1.0 is the more modern package, but its Linux path requires a `node-gyp` compile that is fragile under Bun (no guaranteed `node-gyp`/headers). Revisit node-pty when it ships a Linux prebuild in its tarball.

**Engine Node runtime: Node 24 — for the PTY layer specifically.**
- node-pty does **not** need Node 22; the N-API prebuilds load fine on Node 24. The original ADR-0007 risk (no Node-24 prebuild) does **not** materialize.
- node-pty **cannot run under Bun on Windows** (ERR_SOCKET_CLOSED). Therefore the `pty-supervisor` runs **under Node** (as the architecture's "crashable child process"). The rest of the monorepo can stay on Bun for install/build/most tests; only the PTY-touching process is pinned to Node.

**CI install strategy:**
1. Root `package.json` → `"trustedDependencies": ["@homebridge/node-pty-prebuilt-multiarch"]` so `bun install` runs `prebuild-install` (win/mac download). Linux prebuild is bundled, so it needs nothing.
2. CI adds `actions/setup-node@v4` (node 24) so the PTY integration test can shell out to a deterministic Node for the real spawn/kill round-trip. `bun test` itself still runs under Bun.
3. **CI risk (explicit):** (a) `prebuild-install` is *deprecated* upstream (still functional; the homebridge prebuild matrix is actively maintained for the Homebridge ecosystem). (b) win/mac prebuilds are a network download from GitHub releases at install → a GitHub outage/rate-limit would fail `bun install`; linux is offline-bundled. (c) macOS prebuild availability is asserted from the package's published node-abi release matrix — verified by load on **win** + **linux-bundled** here, but **not runnable on this Windows host for darwin**; first macOS CI run is the confirmation.

---

## 4. Implementation (done) — `packages/pty-supervisor`

Wired the chosen package into a real minimal supervisor implementing the existing contract:
- `PtySupervisor`: `spawn(opts) → PtySession`, `write`, `onData (→ unsubscribe)`, `resize`, `kill (tree-kill of the tracked root PID; idempotent)`, plus `pidOf`/`list`/`has`. Per-session PID tracked for whole-tree termination. `resolveShell(kind)` maps every `ShellKind` to an executable + args cross-platform.
- Deps added: `@homebridge/node-pty-prebuilt-multiarch@0.13.1`, `tree-kill@1.2.2`. Build script set to `--target node --packages external` (native dep not bundled). `allowImportingTsExtensions` enabled locally so the Node worker can import `./index.ts`.
- **Integration test** (`src/index.test.ts`, runs under `bun test`): spawns a **Node** child (`src/pty-worker.ts`) that drives the *real* `PtySupervisor` through spawn → stream → resize → tree-kill on the host shells (PowerShell + cmd on Windows; bash on POSIX), and asserts `WORKER_RESULT=PASS` + exit 0. The worker spawns a sleeping grandchild and verifies it is dead after `kill()` (genuine tree-kill assertion, not just root).
- Root `package.json` `trustedDependencies` set; `.github/workflows/ci.yml` adds Node 24 setup.

### Local green results (Windows, this host)
```
bun install --frozen-lockfile   → in sync, no changes
bun run lint     (biome)         → Checked 99 files, 0 errors
bun run typecheck (tsc --noEmit) → 17 successful, 17 total
bun run build    (turbo)         → 17 successful, 17 total
bun run test     (turbo→bun)     → 4/4 tasks; pty-supervisor 4 pass:
    integration > spawns powershell … tree-kills the process tree  [6451ms]  PASS
    integration > spawns cmd …        tree-kills the process tree   [5876ms]  PASS
banned-token scan (rg per RUBRIC §6.1) → clean (no matches)
orphan check (tasklist/CIM)      → no orphaned shells/conhosts after kill
```

---

## 5. Proposed DECISIONS addendum (applied as ADR-0007a)

> ## ADR-0007a — PTY validation gate outcome: package + runtime pinned
> - **Date:** 2026-06-14 · **Status:** Accepted (resolves the ADR-0007 RISK flag)
> - **Context:** Phase 2 opened with the ADR-0007 load-validation gate. Findings on the Windows host: (1) official `node-pty@1.1.0` is N-API and its bundled win/mac prebuilds load cleanly on **Node 24** (the feared "no Node-24 prebuild" does not occur), but it ships **no Linux prebuild** (compiles via node-gyp). (2) **Critically, node-pty cannot run under Bun on Windows** — its ConPTY data pipe rides a `net.Socket` that Bun tears down (`ERR_SOCKET_CLOSED`); this affects every node-pty fork.
> - **Decision:** Use **`@homebridge/node-pty-prebuilt-multiarch`** (prebuilds for win32-x64 + darwin + linux-x64/musl, incl. Node 24 ABI — no compiler on any CI runner) with **`tree-kill`**. Run the `pty-supervisor` **under Node 24, never Bun** (it already lives in a crashable child process per architecture §1/§5). Add the package to Bun `trustedDependencies` (so win/mac prebuilds download at install); add `actions/setup-node@v4` (node 24) to CI so the integration test drives PTYs through Node.
> - **Consequences:** PTYs work on Windows/macOS/Linux with no build toolchain in CI. The monorepo stays on Bun for install/build/most tests; only the PTY-touching process is pinned to Node. Watch items: `prebuild-install` is deprecated upstream (still functional), and win/mac prebuilds are a network download at install (Linux is offline-bundled). Re-evaluate official `node-pty` if/when it bundles a Linux prebuild.
