import Pusher from "pusher"

// Lazy singleton — returns null when Pusher isn't configured so callers
// can silently fall back to polling.
let _pusher: Pusher | null | undefined

export function getPusher(): Pusher | null {
  if (_pusher === undefined) {
    const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env
    _pusher = PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER
      ? new Pusher({
          appId: PUSHER_APP_ID,
          key: PUSHER_KEY,
          secret: PUSHER_SECRET,
          cluster: PUSHER_CLUSTER,
          useTLS: true,
        })
      : null
  }
  return _pusher
}
