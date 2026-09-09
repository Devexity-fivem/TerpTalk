import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import { rateLimit } from "@/lib/rate-limit"
import { logSecurityEvent } from "@/lib/security"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
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

        const user = await prisma.user.findFirst({
          where: {
            profile: {
              // Case-insensitive — registration enforces unique-insensitive
              // usernames, so this can't match the wrong account
              username: { equals: credentials.username.trim(), mode: "insensitive" },
            },
          },
          include: {
            profile: true,
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
          image: user.image,
          role: user.role,
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
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string
        (session.user as { username?: string }).username = token.username as string
        (session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
}
