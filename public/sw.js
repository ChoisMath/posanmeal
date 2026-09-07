const CACHE_VERSION = "posanmeal-v7";
// Only fully-public kiosk routes are precached. Authenticated pages redirect
// when anonymous, so they can never be stored as a usable offline copy.
const KIOSK_PAGES = ["/check", "/facecheck"];
// A kiosk on weak Wi-Fi must not hang on navigation: after this long the
// cached copy is served while the network response keeps refreshing the cache.
const PAGE_NETWORK_TIMEOUT_MS = 5000;

const OFFLINE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>오프라인</title>
<style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#fef8f1;color:#1f2937;text-align:center}
main{padding:24px}h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 20px;opacity:.75;white-space:nowrap}
button{min-height:44px;padding:0 24px;border:0;border-radius:9999px;background:#f59e0b;color:#fff;font-size:1rem;font-weight:600}</style></head>
<body><main><h1>오프라인 상태입니다</h1><p>저장된 페이지가 없습니다. 인터넷에 연결한 뒤 다시 열어 주세요.</p>
<button onclick="location.reload()">다시 시도</button></main></body></html>`;

async function precachePage(cache, path) {
  const response = await fetch(path, { cache: "no-store" });
  if (response.ok) await cache.put(path, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // allSettled so a single page failure (offline, 5xx) does not abort install
      Promise.allSettled(KIOSK_PAGES.map((path) => precachePage(cache, path)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
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

function offlineFallback() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Immutable assets (hashed chunks, face models, icons): serve from cache, fill on miss.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}

// Kiosk pages: network-first so a deploy is picked up as soon as the tablet is
// online, cache fallback so the page still opens offline. The cache key is the
// bare pathname (ignoring Vary/RSC headers and the ?key= query) so any
// navigation to the page hits the same stored copy.
async function kioskPage(request, pathname) {
  const cache = await caches.open(CACHE_VERSION);
  const fromNetwork = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(pathname, response.clone());
    return response;
  });
  fromNetwork.catch(() => {});

  const timeout = new Promise((resolve) => setTimeout(() => resolve(undefined), PAGE_NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([fromNetwork, timeout]);
    if (response) return response;
  } catch {}

  const cached = await cache.match(pathname, { ignoreVary: true });
  if (cached) return cached;
  try {
    return await fromNetwork;
  } catch {
    return offlineFallback();
  }
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/models/") ||
    pathname.startsWith("/icon-") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/meal.png"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (KIOSK_PAGES.includes(url.pathname)) event.respondWith(kioskPage(request, url.pathname));
    return;
  }

  if (isStaticAsset(url.pathname)) event.respondWith(cacheFirst(request));
});
