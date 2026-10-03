import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      username?: string
      role?: string
      onboardingCompletedAt?: string | null
      standing?: number
      unlockFrozen?: boolean
      hasRecoveryPhrase?: boolean
    } & DefaultSession["user"]
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
    role?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    username?: string
    role?: string
  }
}
