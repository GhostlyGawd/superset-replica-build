/**
 * `@swarm/sync/server` — the Node-only entry. Importing this pulls in
 * `node:http` and `ws`, so it must never be reachable from the browser-safe `.`
 * entry. The host engine (Node, ADR-0007a) owns the WS server and consumes it
 * from here; browser/PWA clients use the transport-agnostic surface on `.`.
 */
export * from "./server";
export * from "./ws-transport";
