/**
 * Client-side pairing constants. Kept local (not imported from `@swarm/host`) so the
 * PWA bundle never pulls a value out of the daemon module — the host stays the sole
 * authority on validity; this is only for friendly input gating. Mirrors the host's
 * `PAIRING_CODE_LENGTH`.
 */
export const PAIRING_CODE_MIN_LENGTH = 8;
