/**
 * Cloudflare Turnstile verification for open registration.
 *
 * Enabled only when TURNSTILE_SECRET_KEY is set — without it the
 * registration route falls back to the built-in math captcha so local
 * dev and test scripts keep working. The public site key is
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY.
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function turnstileEnabled(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY
}

export async function verifyTurnstile(token: string, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !token || typeof token !== "string") return false
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean } | null
    return data?.success === true
  } catch {
    return false
  }
}
