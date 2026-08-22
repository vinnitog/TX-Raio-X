const CACHE_NAME = "tx-raio-x-v51";
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacidade.html",
  "./termos.html",
  "./css/app.css",
  "./js/app.mjs",
  "./js/auth-config.mjs",
  "./js/auth-controller.mjs",
  "./js/auth-service.mjs",
  "./js/privacy-client.mjs",
  "./js/supabase-client.mjs",
  "./js/demo-analysis.mjs",
  "./js/checkout-client.mjs",
  "./js/checkout-flow.mjs",
  "./js/credit-client.mjs",
  "./js/config.mjs",
  "./js/history-client.mjs",
  "./js/usage.mjs",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
const CACHEABLE_URLS = new Set(
  APP_SHELL.map((path) => new URL(path, self.location.href).href)
);

function canCache(response) {
  return response.ok && !response.headers.get("cache-control")?.includes("no-store");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.search || !CACHEABLE_URLS.has(requestUrl.href)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (canCache(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkResponse = fetch(event.request).then((response) => {
        if (canCache(response)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      return cached || networkResponse;
    })
  );
});
