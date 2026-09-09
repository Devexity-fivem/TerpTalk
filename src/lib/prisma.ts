import { Prisma, PrismaClient } from "@prisma/client"
import { censorText } from "./profanity"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const CENSOR_FIELDS = new Set([
  "content",
  "title",
  "caption",
  "excerpt",
  "description",
  "bio",
])

const EXCLUDED_MODELS = new Set([
  "Notification",
  "Guide",
  "GuideEdit",
  "Category",
  "Badge",
  "AffiliatePartner",
  "AffiliateProduct",
  "ModerationAction",
  "SecurityEvent",
  "RateLimit",
  "Captcha",
  "Block",
  "Follow",
  "Reaction",
  "Bookmark",
  "SavedSearch",
  "CategoryFollow",
  "Report",
])

function censorData(data: unknown): void {
  if (Array.isArray(data)) {
    data.forEach(censorData)
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "string" && CENSOR_FIELDS.has(key)) {
        ;(data as Record<string, string>)[key] = censorText(value)
      } else if (value !== null && typeof value === "object") {
        censorData(value)
      }
    }
  }
}

function profanityMiddleware(params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<unknown>) {
  if (params.model && EXCLUDED_MODELS.has(params.model)) {
    return next(params)
  }
  const args = params.args as Record<string, unknown> | undefined
  if (params.action === "create" || params.action === "createMany" || params.action === "update" || params.action === "updateMany") {
    if (args?.data) censorData(args.data)
  } else if (params.action === "upsert") {
    if (args?.create) censorData(args.create)
    if (args?.update) censorData(args.update)
  }
  return next(params)
}

export const prisma =
  globalForPrisma.prisma ??
  (() => {
    const client = new PrismaClient()
    client.$use(profanityMiddleware)
    return client
  })()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
