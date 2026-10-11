import { Prisma, PrismaClient } from "@prisma/client"
import { censorText } from "./profanity"
import { recordQuery } from "./query-count"

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
  "ThreadFollow",
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

function makeClient() {
  return new PrismaClient().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          recordQuery()
          if (model && EXCLUDED_MODELS.has(model)) return query(args)
          const a = args as Record<string, unknown> | undefined
          if (
            operation === "create" ||
            operation === "createMany" ||
            operation === "update" ||
            operation === "updateMany"
          ) {
            if (a?.data) censorData(a.data)
          } else if (operation === "upsert") {
            if (a?.create) censorData(a.create)
            if (a?.update) censorData(a.update)
          }
          return query(args)
        },
      },
    },
  })
}

// The extension changes write behavior only — no API surface — so the
// client is exposed as a plain PrismaClient for Db/TransactionClient
// assignability.
export const prisma: PrismaClient = (globalForPrisma.prisma ??
  makeClient()) as PrismaClient

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

/**
 * Serialize a single member's check-then-act writes (caps, dedupe checks)
 * that no unique constraint can protect: take a row lock on the User row
 * inside an interactive transaction so a concurrent request waits and
 * re-reads, instead of both passing the same check.
 */
export async function lockUserRow(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`
}
