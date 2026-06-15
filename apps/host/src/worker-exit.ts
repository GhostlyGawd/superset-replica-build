/**
 * Deterministic shutdown for the spawned Node test workers (`host-worker.ts` and
 * `host-lifecycle-worker.ts`). After a worker has computed its verdict it calls
 * {@link finishWorker} to: (1) emit the final `HOST_RESULT`/`WORKER_RESULT` line
 * and wait for it to flush to the parent's stdout pipe; (2) run best-effort
 * graceful teardown bounded by `graceMs` (the host's `close()` force-closes
 * lingering keep-alive sockets + tree-kills every PTY, and the store close
 * releases PGlite); then (3) HARD-EXIT with the result code.
 *
 * Step 3 is the safety net. Even if a stray open handle — an HTTP keep-alive
 * socket, a node-pty ConPTY pipe, or a PGlite connection — would otherwise keep
 * the worker's event loop alive, the worker (and therefore the parent
 * `spawnSync` that blocks on it) can NEVER hang to the 180s test timeout. This is
 * deterministic on every OS and is what makes the Windows runner pass.
 */
import { exit, stdout } from "node:process";

function withTimeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

export async function finishWorker(
  resultLine: string,
  code: number,
  teardown: () => Promise<void>,
  graceMs = 5000,
): Promise<never> {
  // (1) Emit the verdict and wait until it is flushed to the parent's pipe —
  // bounded, so even a back-pressured pipe can never block the exit.
  await Promise.race([
    new Promise<void>((resolve) => {
      stdout.write(`${resultLine}\n`, () => resolve());
    }),
    withTimeout(1000),
  ]);

  // (2) Best-effort graceful teardown, bounded so it can never hang the worker.
  await Promise.race([teardown().catch(() => undefined), withTimeout(graceMs)]);

  // (3) Hard-exit: a lingering socket / PTY pipe / PGlite handle can NEVER keep
  // this worker (and thus the parent test) alive to the spawnSync timeout.
  exit(code);
}
