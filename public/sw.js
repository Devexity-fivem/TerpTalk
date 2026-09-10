// Service worker: offline shell + same-origin static assets only.
// Never caches API responses, auth pages, or cross-origin resources (avatars/CDN).
const CACHE = "terptalk-v2"
const STATIC = ["/", "/logo.png", "/manifest.webmanifest"]

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(STATIC).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url)

  // Ignore non-GET, API, auth, and cross-origin requests.
  if (
    e.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.origin !== self.location.origin
  ) {
    return
  }

  const isStatic = url.pathname.match(/\.(png|jpg|jpeg|webp|svg|ico|js|css|woff2?)$/)

  if (isStatic) {
    // Stale-while-revalidate for same-origin static files.
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(e.request)
        const network = fetch(e.request).then(async (res) => {
          // Only cache valid, same-origin responses to avoid broken opaque responses.
          if (res && res.type === "basic" && res.ok) {
            await c.put(e.request, res.clone())
          }
          return res
        })
        return cached || network
      })
    )
    return
  }

  // Network-first for pages; fall back to cached shell only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => res)
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/")))
  )
})
