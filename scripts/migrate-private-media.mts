// One-time storage migration: re-store restricted-class media
// (DiaryImage / PostImage / SetupImage) as access:"private" so an old
// public blob URL stops resolving at the storage layer. Rows keep working
// because every viewer-facing surface serializes /api/media/[kind]/[id]
// and the proxy re-evaluates authorization per request.
//
// Safe to re-run — rows already on private URLs (or dev data: URIs) are
// skipped. Non-destructive order per object: copy → repoint row → del old.
// A row is only repointed after the private copy exists. A source delete
// that cannot be confirmed counts as FAILED and exits non-zero — a run
// that leaves a public object behind must never look successful.
//
//   npx tsx scripts/migrate-private-media.mts                  # live run
//   npx tsx scripts/migrate-private-media.mts --dry-run        # count only
//   npx tsx scripts/migrate-private-media.mts --list-store     # audit store vs rows
//   npx tsx scripts/migrate-private-media.mts --revoke-orphans # orphan report (dry-run)
//   npx tsx scripts/migrate-private-media.mts --revoke-orphans --confirm  # delete twin-safe orphans
//
// Orphan remediation is deliberately conservative: an unreferenced public
// object is only revocable when a private object exists at the same
// pathname (the migrated copy — deleting the public twin destroys nothing).
// Unreferenced public objects with NO private twin could be the only
// surviving copy of something and are never auto-deleted; same for
// unreferenced private objects, which may be the sole copy left by a
// failed repoint. "No DB row" alone is never treated as safe-to-destroy.
//
// Dual-store topology: legacy/public objects live in the public store
// (BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID); migrated objects are written to
// the private store (BLOB_PRIVATE_READ_WRITE_TOKEN). Live migration and
// --list-store need both tokens — one store per credential.
import "./db-guard.mjs"
import { list } from "@vercel/blob"
import { prisma } from "../src/lib/prisma"
import { privatizeBlob, deleteImageStrict, isPrivateBlobUrl, isPublicBlobUrl } from "../src/lib/blob"

const DRY_RUN = process.argv.includes("--dry-run")
const LIST_STORE = process.argv.includes("--list-store")
const REVOKE_ORPHANS = process.argv.includes("--revoke-orphans")
const CONFIRM = process.argv.includes("--confirm")
const BATCH = 200
// storeImage folder prefixes for the three restricted classes.
const RESTRICTED_PREFIXES = ["diary-updates/", "forum/", "setups/"]
// storeImage writes `${folder}/${16 hex chars}.webp` — anything else under
// a restricted prefix is an unknown shape and never auto-remediated.
const EXPECTED_OBJECT = /^[a-f0-9]{16}\.webp$/

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
        // Revocation is part of the migration, not best-effort cleanup:
        // an unrevoked public source is a failed migration for this row.
        if (!(await deleteImageStrict(row.url))) {
          tally.failed++
          console.error(`  FAIL ${name} ${row.id}: public source not revoked (row already private — --list-store will find the orphan)`)
          continue
        }
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

interface StoreObject {
  url: string
  pathname: string
  isPublic: boolean
  prefix: string
}

// Store-side audit: list objects under the restricted prefixes and
// cross-reference pathnames against every image row AND against the
// private side of the store. Per object we report the pathname and class
// only — never a signed URL, token, or row content.
//
// Buckets:
//   referenced-public  — a row still points at it (pre/post-migration live data)
//   referenced-private — a row points at it (migrated)
//   orphan-twin        — unreferenced public WITH a private object at the
//                        same pathname → the migrated copy exists; safe to revoke
//   orphan-unique      — unreferenced public with NO private twin → could
//                        be the only copy; never auto-deleted, needs review
//   orphan-private     — unreferenced private (e.g. repoint-failure
//                        leftover) → could be the only copy; report only
//   suspicious         — pathname doesn't match the storeImage shape
async function listStore(): Promise<number> {
  const publicToken = process.env.BLOB_READ_WRITE_TOKEN || null
  const privateToken = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN || null
  if (!publicToken && !privateToken) {
    console.log("--list-store skipped: no blob tokens configured")
    return 0
  }
  if (!publicToken) console.warn("  WARN: BLOB_READ_WRITE_TOKEN missing — public store not audited")
  if (!privateToken) console.warn("  WARN: BLOB_PRIVATE_READ_WRITE_TOKEN missing — private side not audited; public orphans will classify as unique")
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

  const objects: StoreObject[] = []
  for (const token of [publicToken, privateToken].filter((t): t is string => !!t)) {
    for (const prefix of RESTRICTED_PREFIXES) {
      let cursor: string | undefined
      do {
        const page = await list({ prefix, limit: 1000, token, ...(cursor ? { cursor } : {}) })
        for (const blob of page.blobs) {
          const pathname = blob.pathname.startsWith("/") ? blob.pathname : `/${blob.pathname}`
          objects.push({
            url: blob.url,
            pathname,
            isPublic: new URL(blob.url).hostname.endsWith(".public.blob.vercel-storage.com"),
            prefix,
          })
        }
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
    }
  }

  const privatePaths = new Set(objects.filter((o) => !o.isPublic).map((o) => o.pathname))
  const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1)

  const tally = {
    referencedPublic: 0,
    referencedPrivate: 0,
    orphanTwin: [] as StoreObject[],
    orphanUnique: [] as StoreObject[],
    orphanPrivate: [] as StoreObject[],
    suspicious: [] as StoreObject[],
  }
  for (const o of objects) {
    const expected = EXPECTED_OBJECT.test(basename(o.pathname))
    if (rowUrls.has(o.pathname)) {
      if (o.isPublic) tally.referencedPublic++
      else tally.referencedPrivate++
      continue
    }
    if (!expected) {
      tally.suspicious.push(o)
      continue
    }
    if (!o.isPublic) {
      tally.orphanPrivate.push(o)
    } else if (privatePaths.has(o.pathname)) {
      tally.orphanTwin.push(o)
    } else {
      tally.orphanUnique.push(o)
    }
  }

  console.log(
    `store audit: ${tally.referencedPublic} referenced-public, ${tally.referencedPrivate} referenced-private,` +
      ` ${tally.orphanTwin.length} orphan-public-with-twin, ${tally.orphanUnique.length} orphan-public-unique,` +
      ` ${tally.orphanPrivate.length} orphan-private, ${tally.suspicious.length} suspicious`
  )
  const printCandidate = (kind: string) => (o: StoreObject) =>
    console.log(`  ${kind} ${o.prefix} ${o.pathname} ${o.isPublic ? "public" : "private"}`)
  tally.orphanTwin.forEach(printCandidate("orphan-twin "))
  tally.orphanUnique.forEach(printCandidate("orphan-unique"))
  tally.orphanPrivate.forEach(printCandidate("orphan-private"))
  tally.suspicious.forEach(printCandidate("suspicious   "))

  // Non-zero exit when the store disagrees with "migration complete":
  // a row still references a public object, an unrevoked public orphan
  // exists, or an unknown-shaped object needs a human. Unreferenced
  // private objects are report-only — they are not a public exposure.
  const unresolved = () =>
    tally.referencedPublic + tally.orphanTwin.length + tally.orphanUnique.length + tally.suspicious.length

  if (!REVOKE_ORPHANS) {
    return unresolved()
  }

  // Remediation. Only twin-verified public orphans are eligible — deleting
  // them destroys nothing because the same pathname exists privately.
  if (!CONFIRM) {
    console.log(
      `revoke-orphans DRY RUN: ${tally.orphanTwin.length} twin-verified public orphans eligible;` +
        ` ${tally.orphanUnique.length} unique and ${tally.orphanPrivate.length} private orphans` +
        ` are report-only. Pass --confirm to delete the twin-verified set.`
    )
    return tally.orphanUnique.length + tally.suspicious.length
  }
  let revokeFailed = 0
  for (const o of tally.orphanTwin) {
    if (!(await deleteImageStrict(o.url))) {
      revokeFailed++
      console.error(`  FAIL revoke orphan: ${o.pathname}`)
    }
  }
  console.log(
    `orphan revocation: ${tally.orphanTwin.length - revokeFailed} deleted, ${revokeFailed} failed;` +
      ` ${tally.orphanUnique.length} unique + ${tally.orphanPrivate.length} private + ${tally.suspicious.length} suspicious left for manual disposition`
  )
  return revokeFailed + tally.referencedPublic + tally.orphanUnique.length + tally.suspicious.length > 0 ? -1 : 0
}

async function main() {
  if (!DRY_RUN && !LIST_STORE) {
    // Live migration needs the private token to copy objects and the public
    // token to revoke the sources; orphan revocation deletes public-store
    // objects only.
    const missing = [
      !process.env.BLOB_PRIVATE_READ_WRITE_TOKEN && !REVOKE_ORPHANS && "BLOB_PRIVATE_READ_WRITE_TOKEN",
      !process.env.BLOB_READ_WRITE_TOKEN && "BLOB_READ_WRITE_TOKEN",
    ].filter(Boolean)
    if (missing.length) {
      console.error(`${missing.join(", ")} required for ${REVOKE_ORPHANS ? "--revoke-orphans" : "the live migration"}`)
      process.exit(1)
    }
  }

  if (LIST_STORE || REVOKE_ORPHANS) {
    const rc = await listStore()
    await prisma.$disconnect()
    if (rc !== 0) process.exit(1)
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
