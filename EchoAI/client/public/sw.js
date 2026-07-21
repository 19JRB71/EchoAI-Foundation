/* Zorecho service worker.
 *
 * Served from the site root (public/ is copied verbatim to dist/ by Vite) so it
 * controls the whole app scope ("/"). It does three things:
 *   1. Pre-caches the app shell on install so the dashboard loads instantly even
 *      on slow/flaky mobile connections.
 *   2. Serves cached assets when offline (cache-first for built static assets,
 *      network-first with cache fallback for navigations).
 *   3. Shows a push notification when the backend pushes a hot-lead alert.
 */

// Bump this version string on every client release that must invalidate the
// cached app shell. The `activate` handler deletes every cache whose name does
// not match the current CACHE, so bumping it purges the previously cached
// index.html + hashed JS/CSS. Without a bump, a returning PWA user keeps being
// served the old precached shell (old bundle) forever, regardless of HTTP
// Cache-Control headers — the service worker answers from its own cache first.
const CACHE = "echoai-shell-v143";

// The app shell. Hashed Vite asset filenames are cached at runtime (see fetch
// handler), so we only need the entry points here.
const APP_SHELL = [
  "/",
  "/dashboard",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/zorecho-wordmark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Never cache the API.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached shell when offline so the
  // SPA still boots.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/dashboard")),
        ),
    );
    return;
  }

  // Static assets: cache-first, then fill the cache from the network.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});

// A hot lead came in: show a notification with the lead name + temperature.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Zorecho", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "🔥 Hot lead!";
  const options = {
    body: payload.body || "A lead just turned hot. Reach out now.",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || "echoai-hot-lead",
    data: { url: payload.url || "/dashboard" },
    vibrate: [120, 60, 120],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus (or open) the dashboard when a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
