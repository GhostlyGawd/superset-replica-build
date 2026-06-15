/**
 * Committed TEST SEAM for `tunnel.test.ts` (Phase-5 W3, ADR-0017). This is NOT on
 * any user path — the real cloudflared / localtunnel binary is what `startTunnel`
 * runs in production. It mimics cloudflared just enough to drive the manager
 * deterministically (a real public tunnel cannot run in CI): print a
 * `*.trycloudflare.com` URL on a line of stderr, then idle until killed — so the
 * test can assert the URL is parsed AND that `stop()` actually kills the process.
 *
 * Env knobs (set by the test, never by users):
 *   STUB_TUNNEL_URL  override the printed URL (default a trycloudflare URL)
 *   STUB_NO_URL=1    never print a URL (drives the "bounded honest error" path)
 */
const url = process.env.STUB_TUNNEL_URL ?? "https://test-xyz.trycloudflare.com";
const silent = process.env.STUB_NO_URL === "1";

if (!silent) {
  // Emulate cloudflared's banner: the URL appears on its own line in stderr after a
  // brief delay (the manager must accumulate chunks until the line arrives).
  setTimeout(() => {
    process.stderr.write("Your quick Tunnel has been created! Visit it at:\n");
    process.stderr.write(`  ${url} \n`);
  }, 40);
}

// Idle so there is a live process tree for stop() to tree-kill. Without an active
// handle the process would exit immediately and the kill assertion would be vacuous.
const keepAlive = setInterval(() => {}, 1 << 30);
const shutdown = () => {
  clearInterval(keepAlive);
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
