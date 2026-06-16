# Phase-6 Wave-2 — Whole-product license audit (ADR-0008 OSS-only sign-off)

_Implements ADR-0018 Wave-2 (sign-off evidence) and discharges the promise in **ADR-0008**
("No paid SaaS, fonts, icons, or mandatory API keys … License audit in Phase 6"). Cross-checks
**ADR-0003** (PGlite is the self-hosted DB, not a paid cloud DB), **ADR-0017** (cloudflared /
localtunnel tunnels, nothing paid on the remote path)._

This is a **whole-product** audit: every installed npm dependency (root + all 18 workspace
packages' trees), the non-npm runtime tools the product invokes, and the brand assets (fonts +
icons). Numbers are read from the **actual installed tree on this host**, not from memory.

## Method (the script that was run)

bun installs into an **isolated store** at `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/`
and symlinks only the four hoisted root devDeps into the top-level `node_modules` — so the
authoritative copy of every package in every workspace's dependency forest lives under
`.bun/`. A throwaway walker (`scripts/_license-audit.mjs`, deleted after this run) recursed
that store, parsed each `package.json`, normalized its license (handling the modern `license`
**string**, the `{type,url}` object, the legacy `licenses` **array**, and `SPDX … OR …`
**expressions**), de-duped by `name@version`, and aggregated counts per identifier.

```
bun scripts/_license-audit.mjs        # from repo root D:/GitHub Projects/superset-replica-build
```

Raw run header (stdout): **2089** `package.json` files scanned under `node_modules/.bun` →
**693** unique `name@version` packages → **19** distinct license strings. The per-license
bucket sum equals 693 (no package double-counted).

## License → count (every identifier; OR-expressions kept whole)

| Count | License (SPDX identifier, exact string as published) | Class |
| ---: | --- | --- |
| 566 | MIT | permissive |
| 49 | ISC | permissive |
| 20 | Apache-2.0 | permissive |
| 14 | BSD-3-Clause | permissive |
| 14 | BlueOak-1.0.0 | permissive (Blue Oak Model 1.0.0) |
| 11 | BSD-2-Clause | permissive |
| 4 | **MPL-2.0** | **weak copyleft — flagged below** |
| 2 | MIT OR Apache-2.0 | permissive (dual) |
| 2 | OFL-1.1 | permissive (fonts — SIL Open Font License) |
| 2 | (MIT OR CC0-1.0) | permissive (dual) |
| 1 | 0BSD | permissive |
| 1 | Python-2.0 | permissive (PSF) |
| 1 | CC-BY-4.0 | permissive (data file — `caniuse-lite`) |
| 1 | WTFPL OR ISC | permissive (dual) |
| 1 | (MIT OR WTFPL) | permissive (dual) |
| 1 | (BSD-2-Clause OR MIT OR Apache-2.0) | permissive (triple) |
| 1 | Apache 2.0 | permissive (non-canonical spelling of Apache-2.0 — `qrcode-terminal@0.12.0`) |
| 1 | WTFPL | permissive (`truncate-utf8-bytes@1.0.2`) |
| 1 | (WTFPL OR MIT) | permissive (dual) |

**689 of 693** packages are unambiguously permissive (MIT/ISC/Apache-2.0/BSD-2/3/BlueOak/
0BSD/Python-2.0/CC-BY-4.0/OFL/WTFPL and permissive dual-license expressions). The remaining 4
are MPL-2.0, handled next. **Zero** GPL, **zero** LGPL, **zero** AGPL, **zero** proprietary/
custom/"see-LICENSE", **zero** UNKNOWN/missing-license packages in the entire 693.

## Flag list — every non-permissive / non-obvious identifier, with the acceptability call

Only one license class is non-permissive: **MPL-2.0** (Mozilla Public License 2.0), a
**file-level weak copyleft** — its reciprocity attaches to *modified MPL files*, not to a
larger work that merely consumes the package as an unmodified library. None of the four are
modified; all are used as published. Per-item call:

| Package @ ver | License | On a shipped runtime path? | Acceptability for a distributed OSS product |
| --- | --- | --- | --- |
| `web-push@3.6.7` | MPL-2.0 | **Yes** — runtime `dependency` of `@swarm/host`; imported by `apps/host/src/push.ts` + `notifications-worker.ts` for Web-Push/VAPID (ADR-0014) | **Acceptable.** Consumed unmodified as a library; MPL-2.0's per-file copyleft is not triggered by importing it. We ship/relicense none of its source. Standard for OSS distribution. |
| `axe-core@4.12.1` | MPL-2.0 | **No** — `devDependency` of `apps/desktop` + `apps/mobile`; only injected by the gated `_a11y.spec.ts` measurement specs (the a11y audit). Never bundled into the app. | **Acceptable.** Build/test-only; not in any shipped artifact. Used unmodified. |
| `lightningcss@1.32.0` | MPL-2.0 | **No** — transitive build-time CSS transform (pulled via the Vite 8 / Tailwind dev toolchain); runs at build, emits plain CSS, is not itself shipped. | **Acceptable.** Build-tool, used unmodified; its *output* (CSS) carries no MPL obligation. |
| `lightningcss-win32-x64-msvc@1.32.0` | MPL-2.0 | **No** — the platform-native binary for the above; same build-only status. | **Acceptable.** Same as `lightningcss`. |

Other rows worth an explicit word (all permissive, none blocking):

- **`Apache 2.0`** (one package, `qrcode-terminal@0.12.0`) is just the non-canonical spelling
  of `Apache-2.0`; it is the CLI's pairing-QR renderer and is fully permissive.
- **`CC-BY-4.0`** is `caniuse-lite@1.0.30001799` — a **data file** (browser-support tables)
  pulled transitively by the build toolchain (browserslist/autoprefixer). CC-BY governs the
  dataset, not code, and it is build-only; attribution is satisfied by the retained package.
- **OFL-1.1 ×2** are the two shipped fonts (see Brand assets below) — OFL is the standard
  permissive font license and explicitly permits bundling/redistribution.
- **Dual-license `… OR …`** rows are each satisfiable by their permissive disjunct (we may
  elect MIT/ISC/Apache/CC0 for every one), so they impose no copyleft.

## Non-npm runtime tools (invoked, not bundled)

These are external binaries the product shells out to; they are **not** in `node_modules` and
are not redistributed inside Grove. Versions below were probed on **this host** (`<bin>
--version`):

| Tool | Version on host | License | Role / why OSS-clean |
| --- | --- | --- | --- |
| bun | 1.3.14 | MIT | Primary runtime/test/installer (ADR-0004). |
| node | v24.14.1 | MIT (+ deps' own OSS licenses) | Fallback runtime; runs the PTY/host daemon (ADR-0007a). |
| git | 2.53.0.windows.2 | GPL-2.0 | **Developer/runtime tool, invoked — never linked or bundled.** Grove calls the `git` CLI for worktrees; GPL on a separately-installed CLI tool that we exec creates no obligation on Grove's own (permissive) code. Git is a user prerequisite, like the OS. |
| cloudflared | 2026.6.0 | Apache-2.0 | **Optional** remote tunnel, default provider (ADR-0017). Binary invoked; not shipped. |
| caddy | v2.11.4 | Apache-2.0 | **Local TLS evidence only** — the self-signed-TLS secure-context proof (ADR-0017 W5); never shipped to devices, never required by users. |
| localtunnel (`lt`) | not globally installed (run on demand via `npx`/bun-x) | MIT | Fully-OSS tunnel **fallback** (ADR-0017): used on `cloudflared` ENOENT. Its absence from PATH is expected — the tunnel manager resolves it on demand. |

Git being GPL-2.0 is the only copyleft in the whole product, and it is an **arms-length CLI
invocation of a user-installed prerequisite** (the same status as the user's shell or OS) — it
places no license obligation on Grove. Everything Grove actually ships or links is permissive.

## Brand assets (confirmed against `package.json` + the installed tree)

- **Fonts — IBM Plex via Fontsource:** `@fontsource/ibm-plex-mono@5.2.7` and
  `@fontsource/ibm-plex-sans@5.2.8`, both **OFL-1.1** (verified in their installed
  `package.json`). Declared as runtime deps of `apps/desktop`, `apps/mobile`, `apps/showcase`.
  OFL-1.1 permits bundling and redistribution — matches ADR-0008.
- **Icons — Lucide:** `lucide-react@1.18.0`, **ISC** (verified installed), a runtime dep of
  `@swarm/ui` + the three apps. ISC is permissive.
- **Icons — Phosphor:** ADR-0008 named "Lucide/Phosphor" as the OSS icon options. The
  product as built standardized on **Lucide only** — no `@phosphor-icons/*` package is
  declared in any `package.json` nor present anywhere under `node_modules/.bun`. This is a
  narrowing within the ADR's permitted set (Phosphor is MIT, also OSS), not a deviation; it
  simply means there is no Phosphor license to account for because it is not used.

## Verdict

**Grove is OSS-only.** Every one of the 693 installed packages carries a permissive license
except four MPL-2.0 packages, each of which is weak-copyleft used **unmodified as a library**
(only `web-push` is on a shipped runtime path; the other three are build/test-only) — none of
which obliges anything for distributing Grove's own permissive code. The only non-npm copyleft
is the **git** CLI (GPL-2.0), invoked at arm's length as a user prerequisite, never linked or
shipped.

**No paid SaaS and no mandatory API key sits on any user path.**

- **Database (ADR-0003):** PGlite (Apache-2.0) — Postgres-in-WASM, self-hosted in-process,
  zero external service, zero paid cloud DB; reachable through Drizzle ORM (Apache-2.0).
- **Agents:** the adapters (`packages/agent-adapters/src/descriptors.ts`) are **launchers for
  whatever agent CLI the user already has installed** (`claude`, `codex`, `cursor-agent`,
  `gemini`, or a generic command). Grove stores no API key and **requires none** — the only
  mandatory field anywhere in config is a per-OS *command* string
  (`packages/config/src/index.ts`), not a key. Any LLM credential lives entirely inside the
  user's own CLI, outside Grove.
- **Remote path (ADR-0017):** cloudflared quick-tunnel (Apache-2.0) needs **no account**;
  localtunnel (MIT) is the fully-OSS fallback. Caddy (Apache-2.0) is local TLS evidence only.

**Honest caveat (one).** The *default* remote tunnel, cloudflared's **TryCloudflare** quick
tunnel, is a **free Cloudflare-hosted service** governed by Cloudflare's ToS and availability —
it is free and account-less, but it is a hosted third party, not self-run. This is a
convenience default, not a lock-in: the **localtunnel (MIT)** fallback keeps the entire remote
path self-hostable and fully OSS, exactly as ADR-0017 records. Nothing on the local/LAN path
touches it at all.

## Reproduce

```
# from repo root: walk bun's isolated store, aggregate licenses, list flags
bun scripts/_license-audit.mjs
# spot-check the non-npm tools' versions + licenses
bun --version; node --version; git --version; cloudflared --version; caddy version
```

The walker is a throwaway and is removed after this run; re-create it from the method above or
re-run any equivalent recursive `package.json` license sweep over `node_modules/.bun`.
