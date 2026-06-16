# Phase-6 Security Review — Grove v1.0.0 launch-hardening

Defensive review of our own product (authorized; this is the team's build, reviewed before
its v1.0.0 launch). Every verdict below is grounded in the real source at a cited
`file:line`. No product code was changed by this review — it is read-only; any genuine
must-fix is described for the orchestrator to dispatch separately.

## Threat model

Grove is a **private-by-default, self-hosted** tool. The host is a headless engine that a
user runs on their own machine; a desktop renderer and a mobile PWA drive it. The trust
model rests on two facts:

1. **The host binds loopback by default** (`127.0.0.1`); reaching the network (`--lan`,
   `--host`, or a quick tunnel) is an explicit operator opt-in (P11).
2. **A 256-bit bearer token is the single real gate** on every API/WS call. Origin, CORS,
   and the pairing code are bootstrap/defense-in-depth layers around it, not substitutes.

The adversary we defend against: an unprivileged process or person on the same LAN, an
attacker who sees a pairing QR/URL, a malicious web origin in the user's browser, and a
network observer on the remote-tunnel path. We do **not** defend against an attacker who
already has code execution on the host machine (they can read the manifest token directly —
that is the OS's trust boundary, not Grove's) — and Grove's remote-terminal feature
**intentionally** grants a bearer-holder arbitrary command execution on the host.

---

## Per-area review

### 1. Auth / private-by-default (P11) — PASS

- Loopback default bind: `DEFAULT_BIND_HOST = "127.0.0.1"` (`apps/host/src/server.ts:28`),
  applied at `server.ts:133` (`options.host ?? DEFAULT_BIND_HOST`); `--lan`/`--host` are the
  opt-in. Documented as the privacy default at `server.ts:62-64`.
- Bearer is a 256-bit random token: `randomBytes(32).toString("base64url")`
  (`server.ts:134`).
- The `/trpc/*` guard rejects any request lacking `Authorization: Bearer <token>` with 401,
  except the whitelisted pairing bootstrap (`server.ts:235-243`).
- Token + endpoint are written to a local manifest for same-machine clients
  (`server.ts:293-300`); the manifest lives under `~/.grove/host/manifest.json`
  (`server.ts:108-110`), readable only by the OS user — the intended trust boundary.

### 2. Pairing (ADR-0014) — PASS

- Code space: 8 chars over a 30-symbol unambiguous alphabet ≈ 39 bits
  (`apps/host/src/pair.ts:24-27`).
- TTL 2 min, swept on every access (`pair.ts:30`, `pair.ts:152-159`).
- Single-use: a matched code is marked used and deleted before returning
  (`pair.ts:123-124`).
- Constant-time compare over **every** live code, with a length-oracle burn on mismatch, via
  `timingSafeEqual` (`pair.ts:101-127`, `pair.ts:168-177`).
- 5-strike lockout with a 30 s cooldown caps the online guess rate
  (`pair.ts:33-36`, `pair.ts:135-141`).
- Codes are **in-memory only** (a `Map`, not persisted) so a host restart invalidates all
  outstanding codes (`pair.ts:68-69`, documented `pair.ts:63-67`).
- Mint uses rejection-sampled `randomInt` (no modulo bias) (`pair.ts:143-150`).
- `pair.redeem` is PUBLIC but path-whitelisted **ahead of** the bearer guard, and a batched
  call would change the path and so still hit the guard (`server.ts:33`, `server.ts:235-243`;
  the procedure at `apps/host/src/trpc.ts:141-159`).
- **Bearer is never in the QR/URL.** `pair.start` returns only `{ code, endpoint, expiresAt }`
  (`trpc.ts:133-140`); the CLI encodes `<url>/?code=<CODE>` and prints "The bearer token is
  NOT in the QR" (`apps/cli/src/index.ts:167-170`, `:254`, `:260`, `:268-269`).
- **Bearer first reaches the phone in the redeem response** — `redeem` returns
  `{ endpoint, token, resumeToken }` over the same-origin (HTTPS-over-tunnel) PWA channel
  (`trpc.ts:154-158`).
- PWA stores it in **IndexedDB**, not localStorage, not the SW cache
  (`apps/mobile/src/host/connection-store.ts:11-18`, `:79-82`); disconnect deletes the record
  (`:85-91`).

### 3. CORS / origin (ADR-0017) — CONCERN (accepted residual; not a blocker)

- `GROVE_ALLOWED_ORIGINS` optionally narrows CORS reflection; unset ⇒ permissive (reflect any
  origin) (`apps/host/src/origin-allowlist.ts:14-32`, `:59-70`).
- Loopback + RFC-1918 are **always** allowed even with an allowlist set, so `--lan` / local
  clients never break (`origin-allowlist.ts:34-51`, `:69`).
- CORS is mounted **before** the auth guard so the credential-less OPTIONS preflight is not
  401'd (`server.ts:213-227`).
- **Residual:** with the allowlist unset (the default), the host reflects any web origin's
  `Origin`. This is acceptable because **CORS is not the gate** — a permitted origin still
  cannot call anything without the bearer (`server.ts:235-243`), and a malicious web page
  cannot read the bearer (it lives in the host manifest on disk / the paired phone's
  IndexedDB, neither reachable cross-origin). Reflecting the origin only enables the browser
  to *send* a request; without the token it gets a 401. See finding SEC-1.

### 4. WebSocket auth — PASS (with an accepted residual on token-in-query)

- `/sync` and `/terminal` upgrades are gated by the same bearer via `authorizeRequest`
  (`server.ts:265-290`); an unauthorized terminal upgrade is answered with a raw
  `401` and the socket destroyed (`apps/host/src/terminal-server.ts:184-188`).
- The bearer rides in the `?token=` query because a browser WebSocket handshake cannot set an
  `Authorization` header (`server.ts:112-122`). This is a genuine constraint, not a shortcut.
- **Residual (token-in-URL):** query strings can land in access/proxy logs and browser
  history. Mitigations actually present: (a) Grove writes **no** request-URL/token logging —
  a grep of `apps/host/src` + `packages/*/src` for `console.*` touching `url`/`token`/
  `authorization`/`req.` returns nothing; (b) loopback default means no intermediary proxy;
  (c) over the tunnel, cloudflared terminates TLS so the query is never on the wire in
  cleartext. Acceptable for a private-by-default self-hosted tool. See finding SEC-2.

### 5. Service-worker cache hygiene — PASS

- The SW precaches the app-shell **only** (`self.__WB_MANIFEST`)
  (`apps/mobile/src/sw.ts:43`).
- `/trpc`, `/sync`, `/terminal`, `/healthz`, anything matching `pair.`, **and any request
  carrying an `Authorization` header** are `NetworkOnly` — never read from or written to the
  cache (`sw.ts:27-49`). The navigation fallback explicitly denylists the same API paths
  (`sw.ts:51-57`).
- Net effect: the bearer and every tRPC/auth response are structurally excluded from Cache
  Storage. The token lives only in IndexedDB (cross-referenced with area 2).

### 6. Web Push / VAPID — PASS

- One VAPID keypair, generated once and persisted to `vapid.json`, reused on restart so
  devices stay subscribed (`apps/host/src/push.ts:56-78`).
- The **private** key is used only to sign sends (`push.ts:124-130`, `:193-196`) and is never
  returned to a client. Only `vapid.publicKey` is surfaced —
  `services.vapidPublicKey = vapid.publicKey` (`server.ts:176`), exposed via
  `notifications.vapidPublicKey` (`trpc.ts:424`).
- `subscribePush` is bearer-gated (rides the `/trpc` guard), so only a paired device can
  register a subscription (`trpc.ts:425-440`).
- The VAPID `subject` is a fixed `mailto:` host identity, not a user secret (`push.ts:30-32`).

### 7. Remote tunnel (ADR-0017) — PASS (design/docs verified; runtime is operator-run)

- Over the tunnel the public HTTPS origin terminates TLS at the trusted edge while the host
  stays loopback behind it, and the bearer still gates — the rationale is documented inline
  at `server.ts:203-212` and in the origin-allowlist header (`origin-allowlist.ts:1-11`).
- Self-signed Caddy is local-evidence only; the security model never depends on shipping a
  self-signed cert to a device (consistent with the loopback-behind-edge design above).
- Marked PASS on **design + code**; the live tunnel is an operator action outside this
  repo's runtime, so there is nothing further to assert in source.

### 8. External-process launch (P08, ADR-0013) — PASS

- `workspaces.openExternal` uses `child_process.spawn` (never a PTY)
  (`apps/host/src/open-external.ts:1`, `:113-131`); **no `shell: true`** anywhere — a repo-wide
  grep of `apps/*/src` + `packages/*/src` for `shell: true` returns nothing.
- The worktree path is passed as a **discrete argv element**, not interpolated into a command
  string (`open-external.ts:42-77`), so `execve`/`CreateProcess` semantics prevent
  argument-injection via the path; for the Windows `cmd`/`folder` cases the path is the
  process **cwd**, not an arg (`:53`, `:71`).
- Binaries are resolved defensively (PATHEXT-aware `where.exe`/`which`) before spawn
  (`open-external.ts:85-110`; resolver `packages/agent-adapters/src/presets.ts:114-144`).
  The resolver runs `execFile(finder, [command])` — argv, no shell (`presets.ts:1`, `:133`).
- Windows `.cmd`/`.bat` shims are routed through `cmd.exe /c <resolvedPath> <args…>` with the
  resolved **absolute path** and discrete args (`open-external.ts:116-118`) — no metacharacter
  surface.
- Launches are `detached: true` + `unref()` so the host neither blocks nor owns the child
  (`open-external.ts:119-130`). Target is a strict `z.enum(["editor","terminal","folder"])`
  (`trpc.ts:279`).

### 9. Input validation — PASS

- Every host procedure validates input with zod (`apps/host/src/trpc.ts`, throughout).
  `pair.redeem` bounds the code (`z.string().min(1).max(64)`, `trpc.ts:142`); WS dims are
  range-clamped (`terminal-server.ts:66-69`).
- The generic agent adapter **requires an explicit command** — the orchestrator throws
  `adapter "…" requires an explicit command` when one is absent
  (`apps/host/src/orchestrator.ts:284-288`), and the launch resolves to a concrete executable
  then spawns directly over a PTY with discrete argv (no shell) (`orchestrator.ts:375-393`).
- `adapterId` is a closed `z.enum` (`trpc.ts:174-181`). The **mock adapter is never on a user
  path**: it runs only when `SWARM_ENABLE_MOCK_ADAPTER` is set on the host, with no API field
  to enable it (`trpc.ts:169-181`, comment `:169-173`).
- **Note (by design, not a bug):** the `/terminal` WS accepts a `cmd=` query and runs it in a
  PTY (`terminal-server.ts:104`, `:112-119`). This is the product's remote-terminal feature —
  arbitrary command execution is the *intended* capability of a terminal, and the bearer
  (area 4) is the sole, sufficient gate. Not an injection finding.

### 10. Dependency surface + binary signing

- **`bun audit` (v1.3.14): 2 advisories, both dev-only — PASS as a shipped surface.** Both are
  `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99 moderate; GHSA-gv7w-rqvm-qjhr high), pulled
  transitively via **devDependencies only**: `drizzle-kit` (`packages/db/package.json:34`, used
  by the `db:generate` script) and `vite` / `tailwindcss`
  (`apps/desktop/package.json:41,47,48`). esbuild is **not** a dependency of the shipped daemon
  — `@swarm/host` runtime deps are hono/trpc/web-push/ws/zod with no esbuild
  (`apps/host/package.json`), and `@swarm/cli` ships only `@swarm/host` + `qrcode-terminal`
  (`apps/cli/package.json`). The esbuild dev-server advisory requires running the esbuild dev
  server, which never ships to a device. See finding SEC-3 (informational).
- **Binary signing — CONCERN (disclosed; accepted, not a blocker).** Installers are **unsigned**
  (no paid certs; ADR-0005/0016). SmartScreen (Windows) and Gatekeeper (macOS) implications are
  disclosed to users with exact click-through steps, and the config is structured so a cert can
  be added later without restructuring (`apps/desktop/PACKAGING.md:45-61`). See finding SEC-4.

---

## Findings by severity

| ID | Severity | Area | Finding | File:line | Status |
|----|----------|------|---------|-----------|--------|
| SEC-1 | Low | CORS | Default-permissive CORS reflects any web origin when `GROVE_ALLOWED_ORIGINS` is unset | `origin-allowlist.ts:14-18`, `:59-61`; `server.ts:213-227` | Accepted — bearer is the gate; origin only permits a request that still 401s without the token |
| SEC-2 | Low | WS auth | Bearer travels in the `?token=` query for `/sync` + `/terminal` (browser WS cannot set `Authorization`) | `server.ts:112-122` | Accepted — no app-side URL/token logging, loopback default, TLS-terminated over tunnel |
| SEC-3 | Info | Deps | `esbuild <=0.24.2` (1 high, 1 moderate) via dev-only `drizzle-kit` / `vite` / `tailwindcss`; not in the shipped daemon/CLI | `packages/db/package.json:34`, `apps/desktop/package.json:41,47,48` | Accepted — dev/build tooling only; bump opportunistically |
| SEC-4 | Low | Signing | Installers are unsigned (SmartScreen/Gatekeeper prompts) | `apps/desktop/PACKAGING.md:45-61` | Accepted — disclosed with mitigations; needs a paid EV/Developer-ID cert |

No High or Critical findings against the shipped product. **No launch blocker.**

---

## Verdict

**PASS for v1.0.0 launch.** 7 areas PASS outright; 1 dependency/signing area splits into a
clean shipped-surface (PASS) and a disclosed unsigned-installer CONCERN; the two standing
CONCERNs (default-permissive CORS, bearer-in-WS-query) are **accepted residual risks**, not
defects: both reduce to "the bearer is the only thing that actually authorizes data access,"
which the code enforces consistently, and the private-by-default loopback posture means
neither is reachable by an off-host attacker without the operator first opting into the
network. The pairing bootstrap, SW cache hygiene, VAPID key handling, and external-launch /
adapter command paths are all implemented to the documented model with no gap found.

The four findings above are tracked for follow-up; none gates the release. The single
highest-value hardening if/when budget allows is a code-signing certificate (SEC-4), which
removes the only user-visible security friction at install time.
