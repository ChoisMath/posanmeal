const CACHE_VERSION = "posanmeal-v5";
// Only precache fully-public routes. Authenticated pages redirect when
// anonymous, which would cause cache.addAll to reject and abort install.
const PRECACHE_URLS = ["/check"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // allSettled so a single URL failure (offline, 5xx) does not abort install
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "CLEAR_ALL") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;

  // API requests: always network
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: Cache First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // /check page: Cache First (critical for kiosk offline)
  if (url.pathname === "/check") {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Icons and manifest: Cache First
  if (
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/meal.png"
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Navigation requests: network-first. Only the kiosk /check page gets an
  // offline fallback — swapping an auth page for /check would be confusing.
  if (event.request.mode === "navigate") {
    if (url.pathname === "/check") {
      event.respondWith(
        fetch(event.request).catch(() =>
          caches.match("/check").then((cached) => cached || new Response("Offline", { status: 503 }))
        )
      );
    }
    return;
  }
});
