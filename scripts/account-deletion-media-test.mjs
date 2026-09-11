import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.STAGING_URL || "https://forums-jvxhkibwi-devexity-fivems-projects.vercel.app"
const BYPASS = process.env.VERCEL_BYPASS_TOKEN
if (!BYPASS) throw new Error("Set VERCEL_BYPASS_TOKEN")

const prisma = new PrismaClient()

const tinyPng = () => {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  return `data:image/png;base64,${b64}`
}

async function getCsrf() {
  const res = await fetch(`${BASE}/api/auth/csrf`, { headers: { "x-vercel-protection-bypass": BYPASS } })
  const data = await res.json()
  const cookie = res.headers.getSetCookie?.()?.[0]?.split(";")[0] || res.headers.get("set-cookie")?.split(",")[0]?.split(";")[0]
  return { csrfToken: data.csrfToken, csrfCookie: cookie || "" }
}

async function login(username, password) {
  const { csrfToken, csrfCookie } = await getCsrf()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie, "x-vercel-protection-bypass": BYPASS },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const setCookies = res.headers.getSetCookie?.() || []
  const cookie = [...(csrfCookie ? [csrfCookie] : []), ...setCookies.map((c) => c.split(";")[0])].join("; ")
  const sessionRes = await fetch(`${BASE}/api/auth/session`, { headers: { cookie, "x-vercel-protection-bypass": BYPASS } })
  const session = await sessionRes.json().catch(() => ({}))
  return { cookie, session }
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = { "x-vercel-protection-bypass": BYPASS }
  if (body) headers["Content-Type"] = "application/json"
  if (cookie) headers["cookie"] = cookie
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data, headers: res.headers }
}

async function run() {
  const results = []
  const pass = (n) => { results.push({ n, ok: true }); console.log(`  ✓ ${n}`) }
  const fail = (n, info) => { results.push({ n, ok: false, info }); console.log(`  ✗ ${n} — ${info}`) }

  const username = `m${Date.now()}`
  const password = "TestPass123!"
  const hashed = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      name: `__media_${username}`,
      ageVerified: true,
      password: hashed,
      sessionVersion: 1,
      profile: { create: { username } },
    },
  })

  try {
    console.log("\n=== ACCOUNT DELETION + MEDIA TEST ===\n")

    const { cookie } = await login(username, password)
    if (!cookie) throw new Error("login failed")

    const cats = await api("/api/categories", { cookie })
    const categoryId = cats.data?.categories?.[0]?.id || cats.data?.[0]?.id || "default"

    const threadRes = await api("/api/forum/threads", {
      method: "POST",
      body: { title: "Media deletion test", content: "has image", categoryId, tagInputs: [], images: [tinyPng()] },
      cookie,
    })
    const threadId = threadRes.data?.thread?.id
    const imageRow = threadId ? await prisma.postImage.findFirst({ where: { threadId }, select: { url: true } }) : null
    const imageUrl = imageRow?.url
    if (threadRes.status === 201 && threadId) {
      pass("Thread with image created")
    } else {
      fail("Thread with image", `${threadRes.status} ${JSON.stringify(threadRes.data).slice(0, 200)}`)
    }

    if (imageUrl) {
      const imgRes = await fetch(imageUrl, { headers: { "x-vercel-protection-bypass": BYPASS } })
      imgRes.status === 200 ? pass("Uploaded image accessible after creation") : fail("Image accessible after creation", imgRes.status)

      const publicBefore = await api(`/api/users/${username}`)
      publicBefore.status === 200 ? pass("Public profile exists before deletion") : fail("Public profile before", publicBefore.status)

      const wrongPass = await api("/api/profile", {
        method: "DELETE",
        body: { confirmUsername: username, password: "WrongPass123!" },
        cookie,
      })
      wrongPass.status === 403 ? pass("Rejects wrong password") : fail("Wrong password", wrongPass.status)

      const wrongUser = await api("/api/profile", {
        method: "DELETE",
        body: { confirmUsername: "wronguser", password },
        cookie,
      })
      wrongUser.status === 400 ? pass("Rejects wrong username") : fail("Wrong username", wrongUser.status)

      const missingPass = await api("/api/profile", {
        method: "DELETE",
        body: { confirmUsername: username },
        cookie,
      })
      missingPass.status === 400 ? pass("Rejects missing password") : fail("Missing password", missingPass.status)

      const delRes = await api("/api/profile", {
        method: "DELETE",
        body: { confirmUsername: username, password },
        cookie,
      })
      delRes.status === 200 ? pass("Account deletion accepted") : fail("Account deletion", `${delRes.status} ${JSON.stringify(delRes.data).slice(0, 200)}`)

      const publicAfter = await api(`/api/users/${username}`)
      publicAfter.status === 404 ? pass("Public profile 404 after deletion") : fail("Public profile after", publicAfter.status)

      // Give Blob cleanup a moment, then confirm the URL is no longer accessible.
      await new Promise((r) => setTimeout(r, 2000))
      const imgAfter = await fetch(imageUrl, { headers: { "x-vercel-protection-bypass": BYPASS } })
      // A deleted image may 404 or 403 from Vercel Blob; 200 would be a leak.
      imgAfter.status !== 200 ? pass("Uploaded image no longer accessible after deletion") : fail("Image after deletion", `still 200; possible leak`)
    }
  } catch (err) {
    console.error("\nTest error:", err)
    fail("RUNTIME_EXCEPTION", err.message)
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n=== SUMMARY: passed ${passed}, failed ${failed} ===`)
  process.exit(failed > 0 ? 1 : 0)
}

run()
