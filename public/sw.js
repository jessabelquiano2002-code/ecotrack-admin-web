/* WasteTrack offline service worker.
 * Keeps the Next.js application shell and previously warmed admin routes usable
 * after Vercel/Firebase become unreachable. API calls are deliberately network-only.
 */
const VERSION = "wastetrack-offline-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const CACHE_PREFIX = "wastetrack-offline-";

const CORE_URLS = [
  "/login",
  "/offline",
  "/manifest.webmanifest",
  "/pwa-icons/wastetrack-192.png",
  "/pwa-icons/wastetrack-512.png",
  "/images/images/garbage-truck.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(CORE_URLS.map(async (url) => {
      const response = await fetch(url, { credentials: "same-origin", cache: "reload" });
      if (response.ok || response.type === "opaqueredirect") await cache.put(url, response.clone());
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith("/api/");
}

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

function shouldRuntimeCache(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (isApiRequest(url)) return false;
  return true;
}

async function cacheSuccessful(request, response) {
  if (!response || !(response.ok || response.type === "opaqueredirect")) return response;
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return await cacheSuccessful(request, response);
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const offline = await caches.match("/offline");
    if (offline) return offline;
    return new Response("WasteTrack is offline and this page has not been cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  return cacheSuccessful(request, response);
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  const network = fetch(request)
    .then((response) => cacheSuccessful(request, response))
    .catch(() => null);
  if (cached) {
    void network;
    return cached;
  }
  const response = await network;
  if (response) return response;
  return new Response("Offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;
  if (isApiRequest(url)) return; // Admin API mutations must never be served from cache.
  if (url.origin !== self.location.origin) return; // Do not cache Firebase or remote map traffic.

  // Never answer a Next.js React Server Component request with cached HTML.
  // Exact RSC responses are cached only after they have succeeded online.
  if (isRscRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || request.destination === "style" || request.destination === "script" || request.destination === "font") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (shouldRuntimeCache(request, url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function warmRoute(route) {
  const request = new Request(route, { credentials: "same-origin" });
  const response = await fetch(request);
  if (!(response.ok || response.type === "opaqueredirect")) return;

  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return;

  const html = await response.text();
  const assetUrls = new Set();
  const attributePattern = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = attributePattern.exec(html))) {
    try {
      const asset = new URL(match[1], self.location.origin);
      if (asset.origin !== self.location.origin) continue;
      if (
        asset.pathname.startsWith("/_next/") ||
        asset.pathname.startsWith("/images/") ||
        asset.pathname.startsWith("/pwa-icons/")
      ) {
        assetUrls.add(asset.href);
      }
    } catch {
      // Ignore malformed/non-URL attributes.
    }
  }

  await Promise.allSettled([...assetUrls].map(async (assetUrl) => {
    const assetRequest = new Request(assetUrl, { credentials: "same-origin" });
    const existing = await cache.match(assetRequest);
    if (existing) return;
    const assetResponse = await fetch(assetRequest);
    if (assetResponse.ok) await cache.put(assetRequest, assetResponse.clone());
  }));
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "WARM_ROUTES" || !Array.isArray(data.routes)) return;

  // Warm one route at a time. Fetching every admin page concurrently can
  // create an unnecessary burst of server work immediately after sign-in.
  event.waitUntil((async () => {
    for (const route of data.routes) {
      try {
        await warmRoute(String(route));
      } catch {
        // A route that cannot be warmed should not stop the remaining routes.
      }
    }
  })());
});
