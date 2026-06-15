/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

/**
 * Grove PWA service worker (ADR-0014 decision 6) — `vite-plugin-pwa` injectManifest.
 *
 * Caching policy (token-safe by construction):
 *   - PRECACHE the app-shell ONLY: the built HTML/CSS/JS, icons and manifest, whose
 *     revisioned list `vite-plugin-pwa` injects at `self.__WB_MANIFEST`. Navigations
 *     fall back to the precached `index.html` so the shell opens offline.
 *   - NEVER cache the API / auth surface: `/trpc`, `/sync`, `/terminal`, `/healthz`,
 *     `pair.*`, and ANY request carrying the bearer go straight to the network
 *     (`NetworkOnly`). The bearer lives only in IndexedDB and never enters a cache.
 *     (`/sync` + `/terminal` are WebSocket upgrades the SW does not intercept at all.)
 *
 * Web Push (decision 5): a `push` shows the host's notification; a click focuses or
 * opens the app and routes to the workspace. iOS NOTE: push fires only for an
 * INSTALLED PWA on iOS 16.4+ and requires a user gesture to subscribe.
 */

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: ReadonlyArray<{ readonly url: string; readonly revision: string | null }>;
};

// The API / auth surface — matched on same-origin path, plus any bearer-bearing
// request. These are NetworkOnly: never read from or written to the cache.
const API_PATHS = [/^\/trpc(\/|$)/, /^\/sync(\/|$)/, /^\/terminal(\/|$)/, /^\/healthz(\/|$)/];

function isApiRequest(url: URL, request: Request): boolean {
  if (request.headers.has("authorization")) {
    return true;
  }
  if (url.pathname.includes("pair.")) {
    return true;
  }
  return API_PATHS.some((re) => re.test(url.pathname));
}

// Precache the app-shell. Registered first so its exact-URL routes win; the matcher
// below for the API is checked before the navigation fallback.
precacheAndRoute(self.__WB_MANIFEST);

// API / auth: always the network, never cached (defends the token + tRPC responses).
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && isApiRequest(url, request),
  new NetworkOnly(),
);

// Offline app-shell fallback for SPA navigations — but NOT for the API paths above.
const shellHandler = createHandlerBoundToURL("index.html");
registerRoute(
  new NavigationRoute(shellHandler, {
    denylist: [/^\/trpc(\/|$)/, /^\/sync(\/|$)/, /^\/terminal(\/|$)/, /^\/healthz(\/|$)/],
  }),
);

// Take control of open clients ASAP so the e2e (and a real first visit) sees the SW
// controlling the page without a manual reload.
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  readonly title?: string;
  readonly body?: string;
  readonly url?: string;
  readonly workspaceId?: string;
  readonly tag?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload | undefined) ?? {};
  } catch {
    const text = event.data?.text();
    payload = text ? { body: text } : {};
  }
  const title = payload.title ?? "Grove";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/", workspaceId: payload.workspaceId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const targetUrl = data.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        // Focus an already-open Grove tab and route it to the workspace.
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(targetUrl).catch(() => undefined);
        }
        return;
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
