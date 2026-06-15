# Phase 2 — `@swarm/sync` real-time sync core (P10 + spec §8 resilience)

Self-hosted, OSS sync layer that keeps desktop + mobile clients live with the host
engine and survives disconnects (phone sleep / network switch). Single-writer host,
append-only event log, opaque resume tokens — no CRDT (architecture §4).

## What shipped (files under `packages/sync/src/`)

| File | Role |
| --- | --- |
| `index.ts` | Frame protocol + resume-token codec (extended, not redefined): adds `StoredEvent`, `serializeFrame`/`parseFrame`. Re-exports the rest. |
| `event-log-store.ts` | **`EventLogStore` storage port** (`append→seq`, `readFrom(afterSeq)→events`, `head→seq`) + `InMemoryEventLogStore`. `@swarm/db` implements this later; `@swarm/sync` never imports `@swarm/db`. |
| `event-log.ts` | **EventLog core**: serialized single-writer `append` (atomic seq assign + live fan-out); `subscribeFrom(fromSeq, handlers)` does race-safe catch-up→live (listener attached before the catch-up read; buffer flushed with seq-dedupe). |
| `client.ts` | Transport-agnostic **`SyncClient`** + `SyncTransport`/`SyncConnection` seam. HELLO-with-token, BATCH catch-up, live EVENT tail, idempotent apply by seq, gap→resync, jittered exponential-backoff reconnect that resumes from the last applied seq. |
| `server.ts` | Node **WebSocket server** (`ws`) over an owned `http.Server`. Validates the HELLO token hostId (mismatch ⇒ `RESET`), replays missed events as `BATCH`, emits `CAUGHT_UP`, streams live `EVENT`s, records ACK high-water marks (sync_cursors). Binds `127.0.0.1` (P11). |
| `ws-transport.ts` | `webSocketTransport(url)` — a `ws`-backed `SyncTransport` for Node/desktop. Browser clients supply a global-`WebSocket` transport; the client core is identical. |

Terminal IO is intentionally **out-of-band** (ephemeral PTY topic per §4) — this log carries
state/domain events only.

## Protocol (wire)

- Resume token: `base64({ hostId, seq, v })`, `seq` = highest durably applied event.
- Frames: `HELLO {resumeToken?, topics}` · `BATCH {events[]}` (catch-up, contiguous from
  `token.seq+1`) · `EVENT {seq, event}` (live tail) · `CAUGHT_UP {seq}` · `ACK {seq}` ·
  `PING`/`PONG` · `RESET` · `ERROR {code}`.
- Connect → catch-up (`BATCH`×N, chunked by `batchSize`) → `CAUGHT_UP` → live `EVENT` tail.
- Reconnect: client re-sends HELLO with its current seq; server `readFrom(seq)`. Apply is
  **idempotent by seq**, so a replayed/overlapping event is a no-op.

## Resume / reconnect proof

Two real (non-mock) drivers exercise the disconnect→reconnect→resume path:

1. `event-log.test.ts` — EventLog + `InMemoryEventLogStore`. Append 5, subscribe (sees 1–5),
   **disconnect** (unsubscribe), append 6–8 while away (disconnected subscriber sees nothing),
   **reconnect** `subscribeFrom(5)` → receives **exactly `[6,7,8]` in order**, `CAUGHT_UP=8`,
   then continues live (9). Asserts no duplicates. A separate test appends *during* catch-up
   and proves the event is delivered exactly once (race safety).
2. `ws-sync.test.ts` — **real `ws` server on an ephemeral `127.0.0.1` port** + real
   `SyncClient` over `webSocketTransport`. Catch-up to 4, live 5, `client.disconnect()`,
   append 6–8 while down, `client.start()` reconnects with the resume token → applied stream is
   `[1,2,3,4,5,6,7,8]` (no gaps, no dupes), stays live (9), and `server.clientCursors()`
   reflects the ACKed high-water mark (≥8).
3. `client.test.ts` — `SyncClient` over a fake transport: catch-up, idempotent duplicate
   EVENT, **gap → resync**, and auto-reconnect that re-HELLOs from the last applied seq
   (resume-token seq asserted on the second connection).

Result: **no gaps, no duplicates, strictly in seq order**, live tail resumes after reconnect.

## Deps added (this package only)

`cd packages/sync && bun add ws` → `ws@^8.21.0`; `bun add -d @types/ws` → `@types/ws@^8.18.1`.
Root `package.json` untouched (only `bun.lock` updated by `bun add`, regenerated at merge).
Build script set to `--target node --packages external` (server package; `ws` stays external).

## Windows-specific issue + fix

- **Port binding:** server uses `port: 0` bound to `127.0.0.1` → OS-assigned ephemeral port,
  avoiding EADDRINUSE/permission issues on the Windows host. `url` is resolved from
  `httpServer.address()` after `listen`.
- **Close hang (bun on Windows):** after a reconnect cycle a lingering server-side socket kept
  Node's `server.close` callback from firing, so the test process never exited (and bun's
  output stayed buffered, masking it as a total hang). Fix: own an explicit `http.Server`; in
  `close()` call `closeAllConnections()` and guard `httpServer.close()` with
  `httpServer.listening` (bun's `wss.close()` already stops the shared server). Verified clean
  exit.

## Gate (this package only) — all green on Windows

```
bun run --filter @swarm/sync typecheck   -> Exited with code 0
bun run --filter @swarm/sync build        -> Bundled 6 modules in 19ms (index.js 12.62 KB), code 0
bun test packages/sync                    -> 10 pass / 0 fail, 38 expect() calls, 3 files [296ms]
banned-token rg scan over packages/sync/src -> no matches (clean)
```

No `@swarm/db` import; no full-repo install/build run; nothing committed or pushed.

## Export split — browser-safe `.` vs Node-only `./server` (build-integration fix)

The `.` barrel re-exported `server.ts` (and `ws-transport.ts`), so any consumer bundled for a
browser/neutral target — `@swarm/mobile` (PWA) and `@swarm/host` — pulled in `node:http`/`ws`
transitively and failed: *"Browser polyfill for module 'node:http' doesn't have a matching
export named 'createServer'"* at `server.ts:1`. Fix: keep the Node WS server behind a subpath.

- **`.` (browser-safe):** protocol/frame (de)serialization, resume-token codec, `StoredEvent`,
  the transport-agnostic `SyncClient`, the `EventLog` core, and the `EventLogStore` port +
  `InMemoryEventLogStore`. No static `node:http`/`ws`/`server.ts` import.
- **`./server` (Node-only):** new `server-entry.ts` re-exports `server.ts` (`createSyncServer`)
  and `ws-transport.ts` (`webSocketTransport`) — the only modules touching `node:http`/`ws`.
- `package.json` `exports`: `"."` → `./src/index.ts`; `"./server"` → `./src/server-entry.ts`
  (both with matching `types`+`default`; `moduleResolution: Bundler` reads these, no
  `typesVersions` needed). Build now emits both entries: `bun build ./src/index.ts
  ./src/server-entry.ts --target node --packages external`.
- **`apps/mobile`** imports only the browser-safe surface (`encodeResumeToken` from `.`) — no
  change beyond now resolving cleanly under the default browser target.
- **`apps/host`** is a Node app (engine owner, ADR-0007a); its build script gained
  `--target node --packages external`, and server imports (when wired) come from
  `@swarm/sync/server`, never `.`.
- `ws-sync.test.ts` updated to import `createSyncServer` from `./server` and
  `webSocketTransport` from `./ws-transport` (the rest still from `./index`).

### Full-tree gate (Windows) — all green

```
bun install    -> no changes, 296 packages
bun run lint       -> biome: 115 files, no fixes (PASS)
bun run typecheck  -> 17/17 tasks (PASS)
bun run build      -> 17/17 tasks; host (node, externalized) + mobile (browser, 11 mods) green
bun run test       -> 6/6 tasks; @swarm/sync 10 pass / 0 fail, real-socket resume test green
banned-token rg scan over apps packages docs -> no matches (clean)
```
