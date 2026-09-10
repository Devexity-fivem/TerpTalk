import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function GET(request: Request) {
  const ip = getClientIp(request)
  const ipHash = hashIp(ip)

  try {
    const rl = await rateLimit(`captcha:${ipHash}`, 20, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many captchas. Please try again later." },
        { status: 429 }
      )
    }

    // Simple math: two small numbers added together
    const a = Math.floor(Math.random() * 10) + 1
    const b = Math.floor(Math.random() * 10) + 1
    const answer = String(a + b)

    const captcha = await prisma.captcha.create({
      data: {
        answer,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      select: {
        id: true,
      },
    })

    return NextResponse.json({
      id: captcha.id,
      question: `What is ${a} + ${b}?`,
    })
  } catch (error) {
    console.error("Captcha generation error:", error)
    return NextResponse.json(
      { error: "Failed to generate challenge" },
      { status: 500 }
    )
  }
}
