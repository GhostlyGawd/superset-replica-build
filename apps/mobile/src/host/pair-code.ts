/**
 * Pure helpers for the pairing code — kept framework-free so they are trivially
 * unit-testable (the host is the authority on validity; these only shape input).
 */

/** Canonicalize a typed/scanned code: drop spacing + dashes, uppercase. */
export function sanitizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Read a `?code=` (or `#code=`) auto-fill value off a pairing URL/location. The
 * `grove pair` QR encodes `<endpoint>/?code=<CODE>`, so opening it pre-fills the
 * field; manual entry is the fallback. Returns the sanitized code, or "" if absent.
 */
export function codeFromUrl(url: string): string {
  let search = "";
  let hash = "";
  try {
    const parsed = new URL(url);
    search = parsed.search;
    hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  } catch {
    // Not a full URL (e.g. a bare query string) — parse what we can.
    const qIndex = url.indexOf("?");
    search = qIndex >= 0 ? url.slice(qIndex) : "";
  }
  const fromSearch = new URLSearchParams(search).get("code");
  const fromHash = new URLSearchParams(hash).get("code");
  const raw = fromSearch ?? fromHash ?? "";
  return sanitizeCode(raw);
}
