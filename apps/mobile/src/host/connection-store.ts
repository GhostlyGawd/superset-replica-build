/**
 * The paired host connection, persisted in IndexedDB.
 *
 * Why IndexedDB and not localStorage or the service-worker cache (ADR-0014):
 *   - the bearer is a credential, so it must NEVER be precached by the SW (which
 *     would put it in the Cache Storage the offline shell ships from);
 *   - IndexedDB is the structured, origin-scoped store meant for exactly this, and
 *     it is reachable from both the app and (if ever needed) the SW without caching.
 * A "disconnect" deletes this record, fully unlinking the phone.
 */
export interface HostConnection {
  /** HTTP base of the host, e.g. the same-origin the PWA loaded from. */
  readonly endpoint: string;
  /** The 256-bit bearer, obtained via `pair.redeem` — present ONLY here, never in a URL/QR. */
  readonly token: string;
  /** Sync resume token minted by the redeem (forward-looking; used by the sync client). */
  readonly resumeToken: string;
}

const DB_NAME = "grove";
const DB_VERSION = 1;
const STORE_NAME = "connection";
const RECORD_KEY = "host";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = body(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

function isHostConnection(value: unknown): value is HostConnection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.endpoint === "string" &&
    typeof v.token === "string" &&
    typeof v.resumeToken === "string"
  );
}

/** Read the stored connection, or `null` when this phone is not paired. */
export async function loadConnection(): Promise<HostConnection | null> {
  try {
    const value = await runTransaction<unknown>("readonly", (store) => store.get(RECORD_KEY));
    return isHostConnection(value) ? value : null;
  } catch {
    // A blocked/unavailable IndexedDB (e.g. private mode) reads as "not paired"
    // rather than crashing the shell — the user can re-pair.
    return null;
  }
}

/** Persist the paired connection (overwrites any prior pairing). */
export async function saveConnection(conn: HostConnection): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(conn, RECORD_KEY));
}

/** Forget the paired host — the "disconnect" action. */
export async function clearConnection(): Promise<void> {
  try {
    await runTransaction("readwrite", (store) => store.delete(RECORD_KEY));
  } catch {
    // Best-effort: if the store is already gone, the phone is already unpaired.
  }
}
