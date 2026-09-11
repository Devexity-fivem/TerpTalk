// Service worker: static assets only. Never caches API, auth, or user-specific HTML.
const CACHE = "terptalk-v3"
const STATIC = ["/logo.png", "/manifest.webmanifest"]

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
      .then((keys) => Promise.all(keys.map((k) => k !== CACHE ? caches.delete(k) : Promise.resolve())))
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

  // Cache only same-origin static assets. Dynamic HTML is fetched from the network
  // and is never placed in the service-worker cache.
  const isStatic = url.pathname.match(/\.(png|jpg|jpeg|webp|svg|ico|js|css|woff2?)$/)

  if (isStatic) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(e.request)
        const network = fetch(e.request).then(async (res) => {
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

  // HTML and other dynamic routes: network-only. This prevents private user pages
  // (profiles, messages, settings, etc.) from being persisted in the browser cache.
  e.respondWith(fetch(e.request))
})
