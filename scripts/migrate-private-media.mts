// One-time storage migration: re-store restricted-class media
// (DiaryImage / PostImage / SetupImage) as access:"private" so an old
// public blob URL stops resolving at the storage layer. Rows keep working
// because every viewer-facing surface serializes /api/media/[kind]/[id]
// and the proxy re-evaluates authorization per request.
//
// Safe to re-run — rows already on private URLs (or dev data: URIs) are
// skipped. Non-destructive order per object: copy → repoint row → del old.
// A row is only repointed after the private copy exists. A failed source
// delete leaves a residual public object no row references — re-list the
// store (--list-store) after the run to find those.
//
//   npx tsx scripts/migrate-private-media.mts             # live run
//   npx tsx scripts/migrate-private-media.mts --dry-run   # count only
//   npx tsx scripts/migrate-private-media.mts --list-store # audit store vs rows
//
// Requires BLOB_READ_WRITE_TOKEN with write access to the store (not
// needed for --dry-run row classification).
import "./db-guard.mjs"
import { list } from "@vercel/blob"
import { prisma } from "../src/lib/prisma"
import { privatizeBlob, deleteImage, isPrivateBlobUrl, isPublicBlobUrl } from "../src/lib/blob"

const DRY_RUN = process.argv.includes("--dry-run")
const LIST_STORE = process.argv.includes("--list-store")
const BATCH = 200
// storeImage folder prefixes for the three restricted classes.
const RESTRICTED_PREFIXES = ["diary-updates/", "forum/", "setups/"]

type Row = { id: string; url: string }

interface Tally {
  rows: number
  private: number
  dataUri: number
  unresolvable: number
  migrated: number
  failed: number
}

// Classify a stored URL into the report buckets. `public` rows are the
// only ones the migration can act on — anything else is storage-layer
// unreachable (dev data URIs, foreign hosts, malformed strings) and is
// guarded exclusively by the media proxy.
function classify(url: string): "private" | "dataUri" | "public" | "unresolvable" {
  if (isPrivateBlobUrl(url)) return "private"
  if (url.startsWith("data:")) return "dataUri"
  if (isPublicBlobUrl(url)) return "public"
  return "unresolvable"
}

async function migrateTable(
  name: string,
  fetchBatch: (cursor?: string) => Promise<Row[]>,
  update: (id: string, url: string) => Promise<unknown>,
): Promise<Tally> {
  const tally: Tally = { rows: 0, private: 0, dataUri: 0, unresolvable: 0, migrated: 0, failed: 0 }
  let cursor: string | undefined
  for (;;) {
    const rows = await fetchBatch(cursor)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    for (const row of rows) {
      tally.rows++
      const bucket = classify(row.url)
      if (bucket !== "public") {
        tally[bucket]++
        continue
      }
      if (DRY_RUN) {
        tally.migrated++
        continue
      }
      try {
        const newUrl = await privatizeBlob(row.url)
        if (!newUrl) {
          tally.failed++
          console.error(`  FAIL ${name} ${row.id}: blob token missing`)
          continue
        }
        await update(row.id, newUrl)
        await deleteImage(row.url)
        tally.migrated++
      } catch (error) {
        tally.failed++
        console.error(`  FAIL ${name} ${row.id}:`, error)
      }
    }
    if (rows.length < BATCH) break
  }
  return tally
}

function report(name: string, t: Tally) {
  console.log(
    `${name}: ${t.rows} rows — private ${t.private}, legacy-public ${DRY_RUN ? "to-migrate" : "migrated"} ${t.migrated},` +
      ` data-uri ${t.dataUri}, unresolvable ${t.unresolvable}, failed ${t.failed}`
  )
}

// Store-side audit: list objects under the restricted prefixes and
// cross-reference pathnames against every image row. Finds orphaned
// residual public objects (e.g. a repointed row whose source delete
// failed) that no row scan can see.
async function listStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log("--list-store skipped: BLOB_READ_WRITE_TOKEN not configured")
    return
  }
  const rowUrls = new Set<string>()
  for (const rows of [
    await prisma.diaryImage.findMany({ select: { url: true } }),
    await prisma.postImage.findMany({ select: { url: true } }),
    await prisma.setupImage.findMany({ select: { url: true } }),
  ]) {
    for (const r of rows) {
      try {
        rowUrls.add(new URL(r.url).pathname)
      } catch {
        // malformed row URL — classified elsewhere
      }
    }
  }
  let publicObjs = 0
  let privateObjs = 0
  let orphanedPublic = 0
  for (const prefix of RESTRICTED_PREFIXES) {
    let cursor: string | undefined
    do {
      const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) })
      for (const blob of page.blobs) {
        const host = new URL(blob.url).hostname
        if (host.endsWith(".public.blob.vercel-storage.com")) {
          publicObjs++
          if (!rowUrls.has(blob.pathname.startsWith("/") ? blob.pathname : `/${blob.pathname}`)) orphanedPublic++
        } else {
          privateObjs++
        }
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
  }
  console.log(
    `store audit: ${publicObjs} public + ${privateObjs} private objects under restricted prefixes;` +
      ` ${orphanedPublic} orphaned public (no row reference)`
  )
}

async function main() {
  if (!DRY_RUN && !LIST_STORE && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is required for the live migration")
    process.exit(1)
  }

  if (LIST_STORE) {
    await listStore()
    await prisma.$disconnect()
    return
  }

  console.log(DRY_RUN ? "DRY RUN — classifying restricted media rows" : "Migrating restricted media to private blobs")

  // Dry-run scans every row for a complete classification; the live run
  // prefilters to public-host rows only.
  const where = DRY_RUN ? {} : { url: { contains: ".public.blob.vercel-storage.com" } }

  const diary = await migrateTable(
    "DiaryImage",
    (cursor) =>
      prisma.diaryImage.findMany({
        where, orderBy: { id: "asc" }, take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.diaryImage.update({ where: { id }, data: { url } }),
  )
  const post = await migrateTable(
    "PostImage",
    (cursor) =>
      prisma.postImage.findMany({
        where, orderBy: { id: "asc" }, take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.postImage.update({ where: { id }, data: { url } }),
  )
  const setup = await migrateTable(
    "SetupImage",
    (cursor) =>
      prisma.setupImage.findMany({
        where, orderBy: { id: "asc" }, take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, url: true },
      }),
    (id, url) => prisma.setupImage.update({ where: { id }, data: { url } }),
  )

  report("DiaryImage", diary)
  report("PostImage ", post)
  report("SetupImage", setup)
  await prisma.$disconnect()
  if (diary.failed + post.failed + setup.failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
