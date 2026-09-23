// Shared harness for the HTTP verify suites: fixture user creation,
// credentials login, an api() fetch wrapper, pass/fail collection, and a
// summary finish(). Per-suite differences (username markers, pass marks,
// login return shape, user field defaults) are configuration, not copies.
import "../db-guard.mjs"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

// Hash once per process — fixture users all share the suite password and
// bcrypt(12) dominates suite setup time.
const HASHES = new Map()
const hashOnce = (password) => {
  let h = HASHES.get(password)
  if (!h) { h = bcrypt.hashSync(password, 12); HASHES.set(password, h) }
  return h
}

export function makeHarness({
  // username(tag, ts) — must keep the suite's unique marker; cleanup
  // queries key on these prefixes.
  username,
  // name(tag, ts) — user.name marker; defaults to the common __verify_ form.
  name = (tag, ts) => `__verify_${tag}_${ts}`,
  password = "VerifyPass123!",
  // userDefaults: fields merged into every user.create data. Set a key to
  // undefined to omit it (e.g. onboarding skips sessionVersion +
  // onboardingCompletedAt).
  userDefaults = {},
  // passMark/failMark: the status string stored in results and printed.
  passMark = "✓",
  failMark = "✗",
  // loginShape: "cookie" → { cookie } | "session" → { cookie, session } |
  // "string" → cookie string.
  loginShape = "cookie",
  // summary: "fraction" → `N/M passed` | "counts" → `N passed, M failed` |
  // "none" → no output.
  summary = "fraction",
  base = process.env.VERIFY_URL || "http://localhost:3000",
} = {}) {
  if (typeof username !== "function") throw new Error("makeHarness: username(tag, ts) is required")
  const prisma = new PrismaClient()
  const BASE = base
  const ts = Date.now().toString(36)
  const results = []

  const pass = (n) => { results.push(["PASS", n]); console.log(`  ${passMark} ${n}`) }
  const fail = (n, i) => { results.push(["FAIL", n]); console.log(`  ${failMark} ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

  async function createUser(tag, extra = {}) {
    const user = await prisma.user.create({
      data: {
        name: name(tag, ts),
        ageVerified: true,
        password: hashOnce(password),
        sessionVersion: 1,
        onboardingCompletedAt: new Date(),
        ...userDefaults,
        profile: { create: { username: username(tag, ts) } },
        ...extra,
      },
      include: { profile: true },
    })
    return { ...user, password, username: user.profile.username }
  }

  async function login(loginUsername, loginPassword) {
    const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
    const { csrfToken } = await csrfRes.json()
    const csrfCookie = (csrfRes.headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ")
    const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
      body: new URLSearchParams({ csrfToken, username: loginUsername, password: loginPassword, json: "true" }),
      redirect: "manual",
    })
    const cookies = [...(csrfCookie ? [csrfCookie] : []), ...(res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ")
    if (loginShape === "string") return cookies
    if (loginShape === "session") {
      const session = await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: cookies } })).json().catch(() => ({}))
      return { cookie: cookies, session }
    }
    return { cookie: cookies }
  }

  async function api(path, { method = "GET", body, cookie } = {}) {
    const headers = {}
    if (body) headers["Content-Type"] = "application/json"
    if (cookie) headers["cookie"] = cookie
    let res
    try {
      res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
    } catch (e) {
      return { status: 0, data: { fetchError: String(e) }, location: null }
    }
    let data = null
    try { data = await res.json() } catch { /* html/redirect */ }
    return { status: res.status, data, location: res.headers.get("location") }
  }

  // Prints the configured summary line and returns the process exit code.
  function finish() {
    const failed = results.filter(([s]) => s === "FAIL").length
    if (summary === "fraction") console.log(`\n${results.length - failed}/${results.length} passed`)
    else if (summary === "counts") console.log(`\n${results.length - failed} passed, ${failed} failed`)
    return failed ? 1 : 0
  }

  return { prisma, BASE, ts, results, pass, fail, createUser, login, api, finish }
}
