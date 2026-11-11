// BRIDGE service worker: caches the app shell for fast reopen and an offline
// notice. It never caches API responses, audio, or WebSocket traffic, so no
// conversation content is stored by the worker.
const CACHE = "bridge-shell-v1";
const SHELL = ["/", "/join", "/new", "/privacy", "/languages", "/offline.html", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(url.pathname).then((r) => r || caches.match("/offline.html"))));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || /\.(svg|png|woff2|js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
