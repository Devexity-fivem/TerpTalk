// One canonical definition of "meaningful" diary-update activity, shared by
// grow-journey milestones (TS predicate) and the grow-streak day count (SQL).
// Kept import-free of both consumers to avoid a cycle:
// grow-journey → reputation → grow-streak.
import { Prisma } from "@prisma/client"

export const MIN_UPDATE_LENGTH = 10

export function isMeaningfulUpdate(u: {
  content: string
  images: { id: string }[]
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
  feeding: string | null
  training: string | null
}): boolean {
  if (u.content.trim().length >= MIN_UPDATE_LENGTH) return true
  if (u.images.length > 0) return true
  return (
    u.temperature != null ||
    u.humidity != null ||
    u.vpd != null ||
    u.ph != null ||
    u.ec != null ||
    u.feeding != null ||
    u.training != null
  )
}

// SQL equivalent of isMeaningfulUpdate, aliased `du` (the DiaryUpdate alias
// used by the grow-streak query). Keep in lockstep with the predicate above.
export const MEANINGFUL_UPDATE_SQL = Prisma.sql`
  (
    length(btrim(du."content")) >= ${MIN_UPDATE_LENGTH}
    OR EXISTS (SELECT 1 FROM "DiaryImage" i WHERE i."updateId" = du."id")
    OR du."temperature" IS NOT NULL OR du."humidity" IS NOT NULL OR du."vpd" IS NOT NULL
    OR du."ph" IS NOT NULL OR du."ec" IS NOT NULL
    OR du."feeding" IS NOT NULL OR du."training" IS NOT NULL
  )`
