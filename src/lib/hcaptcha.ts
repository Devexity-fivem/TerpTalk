export interface HCaptchaVerifyResult {
  success: boolean
  challenge_ts?: string
  hostname?: string
  credit?: boolean
  "error-codes"?: string[]
}

const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || "0504ab56-5d20-4ae2-abe0-f444d09edeea"

export async function verifyHcaptcha(token: string, remoteIp?: string): Promise<HCaptchaVerifyResult> {
  const secret = process.env.HCAPTCHA_SECRET_KEY
  if (!secret) {
    throw new Error("HCAPTCHA_SECRET_KEY is not configured")
  }

  const params = new URLSearchParams({
    secret,
    response: token,
    sitekey: HCAPTCHA_SITE_KEY,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  })

  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  return res.json() as Promise<HCaptchaVerifyResult>
}
