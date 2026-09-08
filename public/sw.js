// Minimal service worker — offline shell + cache-first for static assets.
// Never caches API responses or auth pages (privacy).
const CACHE = "terptalk-v1"
const STATIC = ["/", "/logo.png", "/manifest.webmanifest"]

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== "GET") return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return

  // Cache-first for static files, network-first for pages
  if (url.pathname.match(/\.(png|jpg|webp|svg|ico|js|css|woff2?)$/)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const clone = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, clone))
        return res
      }))
    )
    return
  }

  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
})
