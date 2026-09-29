// One-time storage migration: re-store restricted-class media
// (DiaryImage / PostImage / SetupImage) as access:"private" so an old
// public blob URL stops resolving at the storage layer. Rows keep working
// because every viewer-facing surface serializes /api/media/[kind]/[id]
// and the proxy re-evaluates authorization per request.
//
// Safe to re-run — rows already on private URLs (or dev data: URIs) are
// skipped. Non-destructive order per object: copy → repoint row → del old.
// A row is only repointed after the private copy exists.
//
//   npx tsx scripts/migrate-private-media.mts           # live run
//   npx tsx scripts/migrate-private-media.mts --dry-run # count only
//
// Requires BLOB_READ_WRITE_TOKEN with write access to the store.
import "./db-guard.mjs"
import { prisma } from "../src/lib/prisma"
import { privatizeBlob, deleteImage } from "../src/lib/blob"
import { isPrivateBlobUrl } from "../src/lib/media"

const DRY_RUN = process.argv.includes("--dry-run")
const BATCH = 200

type Row = { id: string; url: string }

async function migrateTable(
  name: string,
  fetchBatch: (skipIds: string[]) => Promise<Row[]>,
  update: (id: string, url: string) => Promise<unknown>,
): Promise<{ scanned: number; migrated: number; failed: number }> {
  let scanned = 0
  let migrated = 0
  let failed = 0
  // Process in keyset order; skip rows we already moved so re-runs and
  // partial failures resume cleanly.
  let cursor: string | undefined
  for (;;) {
    const rows: Row[] = await fetchBatch(cursor ? [cursor] : [])
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      scanned++
      if (isPrivateBlobUrl(row.url) || row.url.startsWith("data:")) continue
      if (!row.url.includes(".public.blob.vercel-storage.com")) continue
      if (DRY_RUN) { migrated++; continue }
      try {
        const newUrl = await privatizeBlob(row.url)
        if (newUrl) {
          await update(row.id, newUrl)
          // Delete the public source only after the row repoints — a
          // failed delete leaves a residual public object, not lost data.
          await deleteImage(row.url)
          migrated++
        }
      } catch (error) {
        failed++
        console.error(`  FAIL ${name} ${row.id}:`, error)
      }
    }
    if (rows.length < BATCH) break
  }
  return { scanned, migrated, failed }
}

async function main() {
  if (!DRY_RUN && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is required for the live migration")
    process.exit(1)
  }

  console.log(DRY_RUN ? "DRY RUN — counting legacy public blobs" : "Migrating restricted media to private blobs")

  const diary = await migrateTable(
    "DiaryImage",
    (cursorIds) =>
      prisma.diaryImage.findMany({
        where: { url: { contains: ".public.blob.vercel-storage.com" } },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursorIds.length ? { cursor: { id: cursorIds[0] }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.diaryImage.update({ where: { id }, data: { url } }),
  )
  const post = await migrateTable(
    "PostImage",
    (cursorIds) =>
      prisma.postImage.findMany({
        where: { url: { contains: ".public.blob.vercel-storage.com" } },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursorIds.length ? { cursor: { id: cursorIds[0] }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.postImage.update({ where: { id }, data: { url } }),
  )
  const setup = await migrateTable(
    "SetupImage",
    (cursorIds) =>
      prisma.setupImage.findMany({
        where: { url: { contains: ".public.blob.vercel-storage.com" } },
        orderBy: { id: "asc" },
        take: BATCH,
        ...(cursorIds.length ? { cursor: { id: cursorIds[0] }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.setupImage.update({ where: { id }, data: { url } }),
  )

  console.log(`DiaryImage: ${diary.migrated}/${diary.scanned} migrated (${diary.failed} failed)`)
  console.log(`PostImage:  ${post.migrated}/${post.scanned} migrated (${post.failed} failed)`)
  console.log(`SetupImage: ${setup.migrated}/${setup.scanned} migrated (${setup.failed} failed)`)
  await prisma.$disconnect()
  if (diary.failed + post.failed + setup.failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
