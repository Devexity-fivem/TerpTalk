import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logSecurityEvent, getClientIp, hashIp, bcryptDecoy } from "@/lib/security"
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile"
import bcrypt from "bcryptjs"

export const secureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") || !!process.env.VERCEL
export const sessionCookieName = secureCookies ? "__Host-next-auth.session-token" : "next-auth.session-token"
const csrfCookieName = secureCookies ? "__Host-next-auth.csrf-token" : "next-auth.csrf-token"

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: secureCookies,
  cookies: {
    sessionToken: {
      name: sessionCookieName,
      options: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "strict",
        path: "/",
      },
    },
    csrfToken: {
      name: csrfCookieName,
      options: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "strict",
        path: "/",
      },
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // refresh token once per day
  },
  jwt: {
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
        // Fresh Turnstile token forwarded by the sign-in form; only
        // consulted once the per-username bucket is saturated.
        turnstileToken: { label: "Verification", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Invalid credentials")
        }

        const usernameKey = credentials.username.trim().toLowerCase()
        const ip = getClientIp(req as unknown as Request)
        const userAgent = (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null

        // Hard caps — checked first and never bypassable by a challenge:
        // per source IP (spraying across many accounts) and per
        // username×IP pair (grinding one account from a single address).
        const [ipRl, pairRl] = await Promise.all([
          rateLimit(`login-ip:${hashIp(ip)}`, 30, 15 * 60 * 1000),
          rateLimit(`login-pair:${usernameKey}:${hashIp(ip)}`, 20, 15 * 60 * 1000),
        ])
        if (!ipRl.allowed || !pairRl.allowed) {
          await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
            ip,
            userAgent,
            metadata: { endpoint: "auth/callback/credentials", scope: ipRl.allowed ? "pair" : "ip" },
          })
          throw new Error("Too many attempts. Please try again later.")
        }

        // The per-username bucket escalates to a challenge instead of a
        // hard denial: an attacker keeping the bucket saturated cannot
        // lock the owner out — a valid Turnstile token lets a human
        // through to the credential check while pair/IP caps still bound
        // the total attempt volume.
        const acctRl = await rateLimit(`login:${usernameKey}`, 10, 15 * 60 * 1000)
        if (!acctRl.allowed) {
          const challenged =
            turnstileEnabled() &&
            typeof credentials.turnstileToken === "string" &&
            (await verifyTurnstile(credentials.turnstileToken, ip))
          if (!challenged) {
            await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
              ip,
              userAgent,
              metadata: { endpoint: "auth/callback/credentials", scope: "account" },
            })
            throw new Error("Too many attempts. Please try again later.")
          }
          await logSecurityEvent("LOGIN_CHALLENGE_PASSED", {
            userAgent,
            metadata: { endpoint: "auth/callback/credentials" },
          })
        }

        const user = await prisma.user.findFirst({
          where: {
            profile: {
              // Case-insensitive — registration enforces unique-insensitive
              // usernames, so this can't match the wrong account
              username: { equals: credentials.username.trim(), mode: "insensitive" },
            },
          },
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            sessionVersion: true,
            password: true,
            banned: true,
            suspendedUntil: true,
            profile: { select: { username: true, avatarUrl: true } },
          },
        })

        if (!user || !user.password) {
          // Uniform error AND uniform timing — do not reveal whether the
          // account exists.
          await bcryptDecoy(credentials.password, 12)
          // userFound is internal-only metadata (SecurityEvent is never
          // user-visible) so transient lookup misses stay diagnosable
          // without changing what the client is told.
          await logSecurityEvent("LOGIN_FAILURE", {
            userAgent,
            metadata: { reason: "invalid_credentials", userFound: !!user },
          })
          throw new Error("Invalid credentials")
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isCorrectPassword) {
          // Uniform error — wrong password never reveals account status
          // or existence, even for banned/suspended accounts.
          await logSecurityEvent("LOGIN_FAILURE", {
            userId: user.id,
            userAgent,
            metadata: { reason: "invalid_credentials" },
          })
          throw new Error("Invalid credentials")
        }

        // Password is correct, so the caller is the account owner — the
        // distinct error lets a suspended/banned member self-diagnose via
        // /restricted instead of chasing a phantom "wrong password".
        const isSuspended = !!user.suspendedUntil && user.suspendedUntil > new Date()
        if (user.banned || isSuspended) {
          await logSecurityEvent("LOGIN_FAILURE", {
            userId: user.id,
            userAgent,
            metadata: { reason: user.banned ? "banned" : "suspended" },
          })
          throw new Error(user.banned ? "AccountBanned" : "AccountSuspended")
        }

        await logSecurityEvent("LOGIN_SUCCESS", {
          userId: user.id,
          userAgent,
        })

        return {
          id: user.id,
          name: user.profile?.username || user.name,
          image: user.profile?.avatarUrl || user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = user.name || undefined
        token.role = (user as { role?: string }).role
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        // Fresh DB check: reject banned users and stale role/version tokens
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { banned: true, suspendedUntil: true, name: true, role: true, sessionVersion: true, image: true, onboardingCompletedAt: true, profile: { select: { username: true, avatarUrl: true } } },
        })
        const isSuspended = !!user?.suspendedUntil && user.suspendedUntil > new Date()
        if (!user || user.banned || isSuspended || (user.sessionVersion ?? 0) !== (token.sessionVersion ?? 0)) {
          return { ...session, user: {} as typeof session.user }
        }
        const displayName = user.profile?.username || user.name || undefined
        const displayUsername = user.profile?.username || undefined
        ;(session.user as { id?: string }).id = token.id as string
        ;(session.user as { name?: string }).name = displayName
        ;(session.user as { username?: string }).username = displayUsername
        ;(session.user as { role?: string }).role = user.role
        ;(session.user as { image?: string | null }).image = user.profile?.avatarUrl || user.image
        ;(session.user as { onboardingCompletedAt?: string | null }).onboardingCompletedAt =
          user.onboardingCompletedAt ? user.onboardingCompletedAt.toISOString() : null
      }
      return session
    },
  },
}
