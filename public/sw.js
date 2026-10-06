// Service worker: static assets only. Never caches API, auth, or user-specific HTML.
const CACHE = "terptalk-v3"
// Entries here must match the isStatic extension list in the fetch handler —
// /manifest.webmanifest was pre-cached but never servable (dead cache entry).
const STATIC = ["/logo.png"]

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

  // Ignore non-GET, API, auth, and cross-origin requests. Local dev never
  // caches (the worker can be registered there by the push opt-in, and a
  // cached dev chunk would break hot reload).
  if (
    self.location.hostname === "localhost" ||
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

// ── Web Push ─────────────────────────────────────────────────────────
// Payloads are produced by src/lib/web-push.ts for an existing in-app
// notification: { title, body, url, tag, category }. The OS notification
// is a pointer back into the site — it carries no extra content.
const SAFE_PATH = /^\/(?!\/)[^\s\\]*$/

self.addEventListener("push", (e) => {
  let data = {}
  try {
    data = e.data ? e.data.json() : {}
  } catch {
    data = {}
  }
  const url = typeof data.url === "string" && SAFE_PATH.test(data.url) ? data.url : "/notifications"
  e.waitUntil(
    self.registration.showNotification(typeof data.title === "string" ? data.title : "TerpTalk", {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/logo.png",
      badge: "/logo.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url, category: typeof data.category === "string" ? data.category : null },
    })
  )
})

self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const { url = "/notifications", category = null } = e.notification.data || {}
  const target = new URL(SAFE_PATH.test(url) ? url : "/notifications", self.location.origin).href
  e.waitUntil(
    Promise.all([
      // Same-origin fetch carries the session cookie; the route records
      // type + category only.
      fetch("/api/push/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CLICKED", category }),
      }).catch(() => {}),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
        const same = wins.find((w) => new URL(w.url).origin === self.location.origin)
        if (same) return same.navigate(target).then((w) => (w || same).focus()).catch(() => self.clients.openWindow(target))
        return self.clients.openWindow(target)
      }),
    ])
  )
})
