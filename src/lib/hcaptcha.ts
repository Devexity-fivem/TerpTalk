export interface HCaptchaVerifyResult {
  success: boolean
  challenge_ts?: string
  hostname?: string
  credit?: boolean
  "error-codes"?: string[]
}

export async function verifyHcaptcha(token: string, remoteIp?: string): Promise<HCaptchaVerifyResult> {
  const secret = process.env.HCAPTCHA_SECRET_KEY
  if (!secret) {
    throw new Error("HCAPTCHA_SECRET_KEY is not configured")
  }

  const params = new URLSearchParams({
    secret,
    response: token,
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  })

  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  return res.json() as Promise<HCaptchaVerifyResult>
}
