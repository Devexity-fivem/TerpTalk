import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logSecurityEvent, getClientIp, hashIp } from "@/lib/security"
import bcrypt from "bcryptjs"

const secureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") || !!process.env.VERCEL
const sessionCookieName = secureCookies ? "__Host-next-auth.session-token" : "next-auth.session-token"
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
      },
      async authorize(credentials, req) {
        if (!credentials?.username || !credentials?.password) {
          throw new Error("Invalid credentials")
        }

        // Rate limit credential attempts: 10 tries per 15 min per username
        // (mitigates credential stuffing without leaking account existence)
        const rl = await rateLimit(
          `login:${credentials.username.toLowerCase()}`,
          10,
          15 * 60 * 1000
        )
        if (!rl.allowed) {
          await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
            userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
            metadata: { endpoint: "auth/callback/credentials" },
          })
          throw new Error("Too many attempts. Please try again later.")
        }

        // Also rate limit by IP to stop distributed credential stuffing
        const ip = getClientIp(req as unknown as Request)
        const ipRl = await rateLimit(`login-ip:${hashIp(ip)}`, 30, 15 * 60 * 1000)
        if (!ipRl.allowed) {
          await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
            ip,
            userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
            metadata: { endpoint: "auth/callback/credentials", scope: "ip" },
          })
          throw new Error("Too many attempts. Please try again later.")
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
            profile: { select: { username: true, avatarUrl: true } },
          },
        })

        if (!user || !user.password) {
          // Uniform error — do not reveal whether the account exists
          await logSecurityEvent("LOGIN_FAILURE", {
            userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
            metadata: { reason: "invalid_credentials" },
          })
          throw new Error("Invalid credentials")
        }

        if (user.banned) {
          await logSecurityEvent("LOGIN_FAILURE", {
            userId: user.id,
            userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
            metadata: { reason: "banned" },
          })
          throw new Error("Invalid credentials")
        }

        const isCorrectPassword = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isCorrectPassword) {
          await logSecurityEvent("LOGIN_FAILURE", {
            userId: user.id,
            userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
            metadata: { reason: "invalid_credentials" },
          })
          throw new Error("Invalid credentials")
        }

        await logSecurityEvent("LOGIN_SUCCESS", {
          userId: user.id,
          userAgent: (req?.headers as Record<string, string> | undefined)?.["user-agent"] ?? null,
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
          select: { banned: true, role: true, sessionVersion: true, image: true, profile: { select: { avatarUrl: true } } },
        })
        if (!user || user.banned || (user.sessionVersion ?? 0) !== (token.sessionVersion ?? 0)) {
          return { ...session, user: {} as typeof session.user }
        }
        ;(session.user as { id?: string }).id = token.id as string
        ;(session.user as { username?: string }).username = token.username as string
        ;(session.user as { role?: string }).role = user.role
        ;(session.user as { image?: string | null }).image = user.profile?.avatarUrl || user.image
      }
      return session
    },
  },
}
