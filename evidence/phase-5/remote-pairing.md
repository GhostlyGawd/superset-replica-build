# Phase-5 W6 — cloudflared remote-pairing trace (real, best-effort)

_ADR-0017 (cloudflared quick-tunnel remote path; tunnel-URL pairing). Per ADR-0017 §6.2 the
live public tunnel + phone-scan is **local-only, non-deterministic** evidence (tunnels are a
Cloudflare-hosted free service); CI proves the secure-context SW+push over local Caddy TLS._

## Summary (honest result)
cloudflared **is installed and runs on this host**, the **product remote path** (the W3
tunnel-manager `apps/cli/src/tunnel.ts`) really spawns the real binary and parses a genuine
`https://<random>.trycloudflare.com` URL, and the **edge control plane connects**. However,
the **live public data path could not be completed from this host's network**: inbound HTTPS
requests reach the Cloudflare edge (TLS + ALPN succeed) but no response is returned (0 bytes,
timeouts), and only **1 of the usual 4 edge connections** ever registers. This is the exact
environment-dependent non-determinism ADR-0017 calls out — so the deterministic remote-path
proofs (the `tunnel.test.ts` stub-seam unit suite + the `secure-context.{md,png}` HTTPS
SW+push run) stand as the gating evidence, with this trace documenting how far the real live
tunnel got here.

## cloudflared — installed (real)
- `scoop install cloudflared` (main bucket) → **cloudflared 2026.6.0** (built 2026-06-08), on
  PATH at `~/scoop/shims/cloudflared`.
- `cloudflared --version` → `cloudflared version 2026.6.0 (built 2026-06-08T11:16 UTC)`.

## What DID work (real captures)

**1. Real grove host booted + local liveness.** The full daemon (`runDaemon` from
`@swarm/host/daemon`: PGlite store + PTY supervisor + tRPC + WS) booted on loopback and
answered its unauthenticated liveness endpoint:
```
host UP  endpoint=http://127.0.0.1:58900  port=58900
LOCAL  GET /healthz -> 200  {"ok":true,"name":"SWARM","hostId":"swarm-63e59d0cf179","online":true}
```

**2. Product tunnel-manager spawned the real cloudflared + parsed the URL.** The W3
`startTunnel({ port })` user-path code (no mock) ran the real binary and resolved a public
HTTPS URL:
```
opening REAL cloudflared quick tunnel (product tunnel-manager)…
TUNNEL UP  provider=cloudflared  pid=30120   (URL parsed in ~3.3s)
TUNNEL URL: https://<random>.trycloudflare.com
```

**3. cloudflared connectivity pre-checks: ALL PASS, edge connection registered.**
```
| DNS Resolution    region1/2.v2.argotunnel.com  PASS  DNS Resolved successfully     |
| UDP Connectivity  region1/2.v2.argotunnel.com  PASS  QUIC connection successful    |
| TCP Connectivity  region1/2.v2.argotunnel.com  PASS  HTTP/2 connection successful  |
| Cloudflare API    api.cloudflare.com:443        PASS  API is reachable             |
SUMMARY: Environment is healthy. cloudflared will use 'quic' as primary protocol.
INF Registered tunnel connection connIndex=0 connection=… location=atl12 protocol=quic
```

**4. The `grove pair --remote` QR payload shape (real `buildPairUrl`).** The QR encodes the
tunnel origin + a one-time code, and the bearer token is never in it (ADR-0014):
```
QR payload:  https://<random>.trycloudflare.com/?code=<ONE-TIME-CODE>
bearer-in-QR?  no — only the tunnel origin + the single-use code
```

## What did NOT complete (the live public round-trip) — diagnosed honestly
Inbound requests to the public URL were probed with both `bun` fetch and Windows `curl`
(8.18.0, Schannel), over IPv4, IPv6, and default, with timeouts up to 45 s, across multiple
fresh tunnels:

- `curl -v` shows the full client-side path succeeds: DNS resolves (Cloudflare anycast
  IPv4 `104.16.230/231.132` + IPv6), TCP connects to the edge on :443, TLS + ALPN negotiate —
  then **`Operation timed out … with 0 bytes received`**. The edge accepts the connection but
  returns nothing.
- Forcing `--protocol http2` proved the request *can* reach cloudflared: it logged
  `originService=http://127.0.0.1:<port>` then `Incoming request ended abruptly: context
  canceled` (the client gave up before a response came back).
- Only **1** edge connection (`connIndex=0`) ever registered (a healthy quick tunnel
  registers ~4 across 2 regions); it did not increase after 30 s.

**Interpretation:** the cloudflared control plane reaches the edge, but this host's network
cannot carry the quick-tunnel *data plane* round-trip (asymmetric/partial edge data-path
reachability). cloudflared, the product tunnel-manager, the host, local liveness, and the
pairing-URL construction are all real and working — the missing piece is the third-party
public edge round-trip, which ADR-0017 explicitly classifies as environment-dependent and
non-deterministic (and why localtunnel is kept as the fully-OSS fallback).

## Deterministic remote-path proofs that DO gate (cited per ADR-0017 §6.2)
- **`apps/cli/src/tunnel.test.ts` — 6/6 stub-seam unit tests** of the real tunnel-manager:
  parses the public HTTPS URL from real process output; `stop()` tree-kills the process (PID
  genuinely dead); a missing binary yields a bounded honest error; a binary that never prints
  a URL times out with a bounded error; `--remote` threads the tunnel URL into the QR payload
  while the bearer never appears; `parseRemoteOptions` lifts `--remote`/`--provider`. The REAL
  cloudflared/localtunnel binary runs on every user path; the seam is only the explicit
  `command` override pointed at a committed stub.
- **`evidence/phase-5/secure-context.{md,png}` — the HTTPS secure-context proof.** A real run
  over a Caddy `tls internal` reverse-proxy in front of the seeded host proved, end to end,
  the SW registers + controls the page over HTTPS, the phone pairs over HTTPS, and
  `pushManager.subscribe` resolves with a real `fcm.googleapis.com` subscription — exactly the
  on-device behavior the cloudflared trusted edge cert lights up remotely. This is the
  recorded proof that the secure-context (the *reason* for the remote path) works; the public
  tunnel only swaps the self-signed local cert for Cloudflare's trusted edge cert.

## Reproduce
```
scoop install cloudflared
cloudflared tunnel --url http://127.0.0.1:<host-port>     # prints https://<random>.trycloudflare.com
# or the full product path:
grove pair --remote                                       # ensures the daemon, opens the tunnel, prints the QR
```
