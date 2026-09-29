import { prisma } from "@/lib/prisma"
import { canViewDiary } from "@/lib/diary-visibility"
import { privatizeBlob, deleteImage, isPublicBlobUrl, isPrivateBlobUrl } from "@/lib/blob"
import { isActiveAuthorRow, isModerator } from "@/lib/security"

/**
 * Restricted media classes — objects whose visibility can change after
 * upload (diary visibility flips, thread/post/setup deletion, hidden
 * staff categories). Their rows always serialize through the
 * authorization-aware /api/media/[kind]/[id] endpoint, which evaluates
 * the same predicates the content pages use — never URL obscurity.
 *
 * Public-class media (avatars, banners, strain photos, contest entries)
 * is not routed through the proxy; its visibility is static and it is
 * intentionally served by the public CDN.
 */
export type MediaKind = "diary" | "post" | "setup"

export const MEDIA_KINDS: readonly MediaKind[] = ["diary", "post", "setup"]

export { isPrivateBlobUrl, isPublicBlobUrl }

export function isMediaKind(value: string): value is MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(value)
}

/**
 * Viewer-facing URL for a restricted-class image row. Always the proxy
 * path — the row id is unguessable (cuid) and authorization is evaluated
 * per request, so the stored blob URL (public legacy or private) is
 * never serialized to viewers.
 */
export function mediaProxyUrl(kind: MediaKind, id: string): string {
  return `/api/media/${kind}/${id}`
}

/** Map image rows to their proxy URLs while preserving other fields. */
export function proxyMedia<T extends { id: string; url: string }>(
  kind: MediaKind,
  images: readonly T[],
): T[] {
  return images.map((img) => ({ ...img, url: mediaProxyUrl(kind, img.id) }))
}

export type MediaViewer = { id?: string | null; role?: string | null }

export type MediaResolution =
  | { ok: true; url: string }
  | { ok: false }

/**
 * Resolve a media row to its blob URL only when `viewer` is authorized
 * for the owning content, using the same predicates as the page layer:
 *
 * - diary  → canViewDiary (PRIVATE = owner only), deleted diary denied
 * - post   → thread/post deletion denied; hidden category = moderators
 * - setup  → deleted setup denied
 * - all    → inactive (banned/suspended) authors denied
 *
 * Block relationships are deliberately NOT enforced here: they filter
 * discovery surfaces, but a blocked viewer can still open a public diary
 * page directly — media must match the content page's verdict, not
 * exceed it.
 */
export async function resolveMediaAccess(
  kind: MediaKind,
  id: string,
  viewer: MediaViewer,
): Promise<MediaResolution> {
  const viewerId = viewer.id ?? undefined
  let url: string | null = null
  let allowed = false

  if (kind === "diary") {
    const img = await prisma.diaryImage.findUnique({
      where: { id },
      select: {
        url: true,
        update: {
          select: {
            diary: {
              select: {
                visibility: true,
                authorId: true,
                deleted: true,
                author: { select: { banned: true, suspendedUntil: true } },
              },
            },
          },
        },
      },
    })
    const diary = img?.update.diary
    if (img && diary && !diary.deleted && isActiveAuthorRow(diary.author)) {
      url = img.url
      allowed = canViewDiary(diary, viewerId)
    }
  } else if (kind === "post") {
    const img = await prisma.postImage.findUnique({
      where: { id },
      select: {
        url: true,
        thread: {
          select: {
            deleted: true,
            authorId: true,
            category: { select: { hidden: true } },
            author: { select: { banned: true, suspendedUntil: true } },
          },
        },
        post: {
          select: {
            deleted: true,
            authorId: true,
            author: { select: { banned: true, suspendedUntil: true } },
            thread: {
              select: {
                deleted: true,
                category: { select: { hidden: true } },
              },
            },
          },
        },
      },
    })
    if (img) {
      const thread = img.thread ?? img.post?.thread
      const author = img.post?.author ?? img.thread?.author
      const deleted = !!(img.thread?.deleted || img.post?.deleted || img.post?.thread?.deleted)
      const hidden = !!(img.thread?.category?.hidden || img.post?.thread?.category?.hidden)
      if (thread && !deleted && isActiveAuthorRow(author)) {
        url = img.url
        allowed = !hidden || isModerator(viewer.role)
      }
    }
  } else {
    const img = await prisma.setupImage.findUnique({
      where: { id },
      select: {
        url: true,
        setup: {
          select: {
            deleted: true,
            authorId: true,
            author: { select: { banned: true, suspendedUntil: true } },
          },
        },
      },
    })
    if (img && img.setup && !img.setup.deleted && isActiveAuthorRow(img.setup.author)) {
      url = img.url
      allowed = true
    }
  }

  if (!allowed || !url) return { ok: false }
  return { ok: true, url }
}

export interface PrivatizeResult {
  /** Rows successfully repointed to private copies. */
  migrated: number
  /**
   * Public Vercel-blob rows that could NOT be privatized — each still
   * resolves publicly via the old URL. Non-zero means the caller must not
   * report a successful privacy transition.
   */
  failed: number
  /**
   * Rows needing no work: already-private objects, data: URIs (dev),
   * and non-Vercel/malformed URLs that no storage ACL can protect — the
   * proxy remains their only privacy boundary.
   */
  skipped: number
}

/**
 * Migrate a diary's legacy public-blob images to access:"private". Runs
 * BEFORE a diary flips to PRIVATE so a previously known URL stops
 * resolving at the storage layer. Fail-closed: any privatizable public
 * object that cannot be repointed counts in `failed`, and the caller
 * aborts the visibility transition — a private diary must never sit on
 * publicly readable blobs because a copy silently failed.
 *
 * Per object: copy private → repoint row → delete source. A failed
 * source delete leaves a residual public object that no row references
 * (logged, listed by the ops verification pass) — never lost content.
 */
export async function privatizeDiaryMedia(diaryId: string): Promise<PrivatizeResult> {
  const rows = await prisma.diaryImage.findMany({
    where: { update: { diaryId } },
    select: { id: true, url: true },
  })
  const result: PrivatizeResult = { migrated: 0, failed: 0, skipped: 0 }
  for (const row of rows) {
    if (isPrivateBlobUrl(row.url) || row.url.startsWith("data:") || !isPublicBlobUrl(row.url)) {
      result.skipped++
      continue
    }
    try {
      const newUrl = await privatizeBlob(row.url)
      if (!newUrl) {
        // Token missing — storage privacy cannot be established.
        result.failed++
        console.error("privatizeDiaryMedia: blob token unavailable, image left public:", row.id)
        continue
      }
      await prisma.diaryImage.update({ where: { id: row.id }, data: { url: newUrl } })
      await deleteImage(row.url)
      result.migrated++
    } catch (error) {
      result.failed++
      console.error("privatizeDiaryMedia: privatize failed for image", row.id, error)
    }
  }
  return result
}
