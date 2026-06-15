import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Single-use pairing codes — the PWA bootstrap (ADR-0014 decision 2).
 *
 * A phone browser cannot read `~/.grove/host/manifest.json`, so it cannot learn
 * the 256-bit bearer the way the Electron desktop does. Instead the host mints a
 * short-lived, single-use *code* that a bearer-gated caller (the `grove pair` CLI)
 * prints as a QR; a PUBLIC `pair.redeem({ code })` exchanges that code for the
 * bearer exactly once. The bearer NEVER travels in the QR/URL — only the code does
 * — so the private-by-default posture (P11) is preserved end to end.
 *
 * Hardening, all enforced here so the public endpoint cannot be brute-forced:
 *   - high entropy: 8 chars from a 30-symbol unambiguous alphabet (~39 bits);
 *   - TTL: a code expires (default 2 min) and is swept;
 *   - single-use: a redeemed code is deleted, so a replay fails;
 *   - constant-time compare: candidates are checked with `timingSafeEqual` so the
 *     response time never reveals which (if any) code matched;
 *   - lockout: after N consecutive bad redeems the endpoint is locked for a cooldown,
 *     capping the online guess rate against the small (~10^12) code space.
 */

/** Unambiguous alphabet — no 0/O, 1/I/L, or U, so a code reads cleanly off a screen. */
const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Code length; 8 symbols over a 30-char alphabet is ~39.3 bits of entropy. */
export const PAIRING_CODE_LENGTH = 8;

/** Default code lifetime: long enough to scan + type, short enough to bound exposure. */
export const PAIRING_CODE_TTL_MS = 2 * 60_000;

/** Consecutive bad redeems before the public endpoint locks out. */
const DEFAULT_MAX_FAILED_REDEEMS = 5;

/** Lockout cooldown after the failure threshold trips. */
const DEFAULT_LOCKOUT_MS = 30_000;

/** A freshly-minted code plus the instant it stops being valid. */
export interface PairingCode {
  readonly code: string;
  readonly expiresAt: number;
}

/** The result of a redeem attempt — never leaks WHY beyond invalid vs. locked. */
export type PairingRedeemResult =
  | { readonly ok: true; readonly resumeToken: string }
  | { readonly ok: false; readonly reason: "invalid" | "locked"; readonly retryAfterMs?: number };

interface StoredCode {
  readonly code: string;
  readonly expiresAt: number;
  used: boolean;
}

export interface PairingStoreOptions {
  readonly ttlMs?: number;
  readonly maxFailedRedeems?: number;
  readonly lockoutMs?: number;
  /** Injectable clock so TTL + lockout are deterministically testable. */
  readonly now?: () => number;
}

/**
 * In-memory store of live pairing codes. One instance per running host; codes are
 * intentionally NOT persisted — a host restart should invalidate every outstanding
 * code (they are seconds-lived bootstrap secrets, not durable state).
 */
export class PairingStore {
  readonly #codes = new Map<string, StoredCode>();
  readonly #ttlMs: number;
  readonly #maxFailed: number;
  readonly #lockoutMs: number;
  readonly #now: () => number;
  #failedRedeems = 0;
  #lockedUntil = 0;

  constructor(options: PairingStoreOptions = {}) {
    this.#ttlMs = options.ttlMs ?? PAIRING_CODE_TTL_MS;
    this.#maxFailed = options.maxFailedRedeems ?? DEFAULT_MAX_FAILED_REDEEMS;
    this.#lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Mint a fresh, unique, single-use code valid for the configured TTL. */
  issue(): PairingCode {
    this.#sweep();
    let code = this.#mint();
    while (this.#codes.has(code)) {
      code = this.#mint();
    }
    const expiresAt = this.#now() + this.#ttlMs;
    this.#codes.set(code, { code, expiresAt, used: false });
    return { code, expiresAt };
  }

  /**
   * Exchange a submitted code for a sync resume token (the caller pairs it with the
   * host bearer + endpoint it already holds). Constant-time over all live codes;
   * consumes the matched code; rate-limited on repeated failures.
   */
  redeem(submitted: string): PairingRedeemResult {
    const now = this.#now();
    this.#sweep();
    if (now < this.#lockedUntil) {
      return { ok: false, reason: "locked", retryAfterMs: this.#lockedUntil - now };
    }

    const candidate = normalizeCode(submitted);
    // Scan EVERY live code with a constant-time compare so the timing does not
    // reveal whether — or which — code matched. A hit must be unused + unexpired.
    let matched: StoredCode | undefined;
    for (const entry of this.#codes.values()) {
      if (constantTimeEquals(candidate, entry.code) && !entry.used && entry.expiresAt > now) {
        matched = entry;
      }
    }

    if (!matched) {
      this.#registerFailure(now);
      return { ok: false, reason: "invalid" };
    }

    matched.used = true;
    this.#codes.delete(matched.code);
    this.#failedRedeems = 0;
    return { ok: true, resumeToken: randomBytes(32).toString("base64url") };
  }

  /** Live (unexpired, unused) code count — for tests/diagnostics only. */
  size(): number {
    this.#sweep();
    return this.#codes.size;
  }

  #registerFailure(now: number): void {
    this.#failedRedeems += 1;
    if (this.#failedRedeems >= this.#maxFailed) {
      this.#lockedUntil = now + this.#lockoutMs;
      this.#failedRedeems = 0;
    }
  }

  #mint(): string {
    let out = "";
    for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
      // randomInt is rejection-sampled, so there is no modulo bias across the alphabet.
      out += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
    }
    return out;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, entry] of this.#codes) {
      if (entry.used || entry.expiresAt <= now) {
        this.#codes.delete(key);
      }
    }
  }
}

/** Normalize user/QR input to the canonical code shape (strip spacing, uppercase). */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** Length-independent, timing-safe string equality (codes are fixed-length anyway). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Burn a comparison so the early-out does not become a length oracle, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
