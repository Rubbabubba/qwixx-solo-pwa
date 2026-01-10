const CACHE = "qwixx-solo-v100";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest"];

// Install: cache core assets
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// Activate: clear old caches and take control immediately
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Fetch: network-first for same-origin navigation/assets; fallback to cache for offline
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML/navigation
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/" ) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || caches.match("./index.html");
      }
    })());
    return;
  }

  // Stale-while-revalidate for CSS/JS (fast + updates soon)
  if (url.pathname.endsWith(".css") || url.pathname.endsWith(".js") || url.pathname.endsWith(".webmanifest")) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((fresh) => {
        cache.put(req, fresh.clone());
        return fresh;
      }).catch(() => null);

      return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
    })());
    return;
  }

  // Default: cache-first
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
