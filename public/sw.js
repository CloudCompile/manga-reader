// Service worker for offline reading.
//
// Two things are worth caching for the stated target (constrained Android
// WebViews on flaky networks):
//   - the app shell, so a cold open works without a round trip, and
//   - page images, so a chapter already read keeps working offline. Images are
//     loaded directly from the publishing host and fall back to /api/proxy, so
//     both the cross-origin image responses and the proxied ones are cached.
//
// Navigation requests use network-first with a cached-shell fallback: serving a
// stale shell over a live one would hide new builds. Images use cache-first.

const SHELL_CACHE = "manga-shell-v1";
const IMAGE_CACHE = "manga-images-v1";
// Bound the image cache so a long series cannot fill the origin quota.
const MAX_IMAGES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/"])).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== IMAGE_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
}

// Cache-first for an image request. Shared by the proxied and direct paths so
// both end up in the same bounded cache and either can serve the other offline.
async function imageCacheFirst(req) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Only cache real images; a 502 error body must not be pinned.
    if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
      cache.put(req, res.clone()).catch(() => undefined);
      trimCache(cache, MAX_IMAGES);
    }
    return res;
  } catch (err) {
    const stale = await cache.match(req);
    if (stale) return stale;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Proxied images: cache-first.
  if (url.pathname === "/api/proxy") {
    event.respondWith(imageCacheFirst(req));
    return;
  }

  // Images loaded directly from a publishing host. They are cross-origin, so
  // they can only be read back from the cache if the response is opaque (no
  // CORS) or the host sends CORS headers; either way `cache.put` accepts the
  // response and `cache.match` returns it. Requests for the page itself, the
  // API, or other assets are left alone.
  if (req.destination === "image" && url.origin !== self.location.origin) {
    event.respondWith(imageCacheFirst(req));
    return;
  }

  // Navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/", res.clone()).catch(() => undefined);
          return res;
        } catch (err) {
          const cache = await caches.open(SHELL_CACHE);
          const shell = await cache.match("/");
          if (shell) return shell;
          throw err;
        }
      })()
    );
  }
});
