// Service worker for offline reading.
//
// Two things are worth caching for the stated target (constrained Android
// WebViews on flaky networks):
//   - the app shell, so a cold open works without a round trip, and
//   - proxied page images, so a chapter already read keeps working offline.
//
// Navigation requests use network-first with a cached-shell fallback: serving a
// stale shell over a live one would hide new builds. Proxied images use
// cache-first, matching the immutable Cache-Control the proxy already sets.

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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Proxied images: cache-first.
  if (url.pathname === "/api/proxy") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          // Only cache real images; a 502 error body must not be pinned.
          if (res.ok && (res.headers.get("content-type") || "").startsWith("image/")) {
            cache.put(req, res.clone());
            trimCache(cache, MAX_IMAGES);
          }
          return res;
        } catch (err) {
          const stale = await cache.match(req);
          if (stale) return stale;
          throw err;
        }
      })()
    );
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
