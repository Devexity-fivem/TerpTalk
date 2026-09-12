// Post-login redirect safety. Only root-relative internal paths are allowed —
// anything else (external URLs, protocol-relative //host, javascript:, data:,
// backslash tricks, malformed input) is rejected. Client- and server-safe.
export function safeCallbackUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null
  const trimmed = url.trim()
  if (!trimmed || trimmed.length > 500) return null
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null
  // No schemes, backslashes, or whitespace anywhere in the path.
  if (/[\s\\]/.test(trimmed) || trimmed.includes(":")) return null
  // Never bounce back into the auth flow itself.
  if (trimmed.startsWith("/auth/")) return null
  return trimmed
}

// Builds a sign-in URL that returns the user to `path` after a successful login.
export function signInHref(path?: string | null): string {
  const safe = safeCallbackUrl(path)
  return safe ? `/auth/signin?callbackUrl=${encodeURIComponent(safe)}` : "/auth/signin"
}
