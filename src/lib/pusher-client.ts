// Shared browser-side Pusher singleton. Every client subscription — chat
// rooms, per-user notification channels — reuses this one connection so
// navigating or switching rooms never multiplies sockets on the free tier.
// Returns null when Pusher isn't configured; callers fall back to polling.
// The PROMISE is cached, not the instance — concurrent callers before the
// lazy import resolves would otherwise each construct their own socket.
type PusherInstance = import("pusher-js").default
let resolvedInstance: PusherInstance | null = null
let sharedPusher: Promise<PusherInstance | null> | null = null

export function getSharedPusher(): Promise<PusherInstance | null> {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
  if (!key || !cluster) return Promise.resolve(null)
  if (!sharedPusher) {
    sharedPusher = import("pusher-js").then(({ default: Pusher }) => {
      resolvedInstance = new Pusher(key, {
        cluster,
        authEndpoint: "/api/pusher/auth",
      })
      return resolvedInstance
    })
  }
  return sharedPusher
}

/** Current shared instance, if one exists — for cleanup that must not await. */
export function peekSharedPusher(): PusherInstance | null {
  return resolvedInstance
}
