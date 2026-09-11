// Vercel Blob storage for user-uploaded images.
// Accepts client-resized data URIs; stores them in Blob and returns a
// small https URL so DB rows stay tiny. Falls back to the data URI when
// BLOB_READ_WRITE_TOKEN isn't configured so nothing breaks locally.
import { put, del } from "@vercel/blob"
import { randomBytes } from "crypto"
import sharp from "sharp"
import { prisma } from "@/lib/prisma"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"

const DATA_URI = /^data:image\/(png|webp);base64,(.+)$/
export const MAX_DATA_URI_LEN = 400_000 // ~300KB binary

export function isValidImageDataUri(s: unknown): s is string {
  return typeof s === "string" && DATA_URI.test(s) && s.length <= MAX_DATA_URI_LEN
}

// Verify actual file signatures — don't trust the declared MIME type.
// Only PNG and WebP are accepted. JPEG is rejected to prevent raw EXIF/GPS
// metadata from being stored on Vercel Blob if a client bypasses the canvas resize.
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  webp: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
}

export const MAX_POST_IMAGES = 4

/**
 * Validate and store a batch of client-resized data URIs.
 * Enforces the count and format limits server-side — the client uploader's
 * own checks are only a convenience and cannot be trusted.
 */
export async function storeImages(
  input: unknown,
  folder: string,
  max = MAX_POST_IMAGES
): Promise<string[]> {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error("Images must be an array")
  if (input.length === 0) return []
  if (input.length > max) throw new Error(`You can attach at most ${max} images`)
  if (!input.every(isValidImageDataUri)) throw new Error("One or more images are invalid or too large")

  const results = await Promise.allSettled(input.map((uri) => storeImage(uri, folder)))
  const urls: string[] = []
  const errors: string[] = []

  for (const result of results) {
    if (result.status === "fulfilled") {
      urls.push(result.value)
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
    }
  }

  if (errors.length > 0) {
    // Any successful uploads are orphaned if the overall batch fails. Clean
    // them up before reporting the error so a multi-image post cannot leave
    // stray Blobs behind.
    await deleteImagesIfUnreferenced(urls)
    throw new Error(errors.join("; "))
  }

  return urls
}

export async function storeImage(dataUri: string, folder: string): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const uploadsEnabled = await getBooleanSetting(SITE_SETTINGS.IMAGE_UPLOADS_ENABLED, true)
    if (!uploadsEnabled) {
      throw new Error("Image uploads are currently disabled")
    }
  } else if (process.env.NODE_ENV !== "development") {
    throw new Error("Image storage is not configured")
  } else {
    return dataUri
  }

  const m = dataUri.match(DATA_URI)
  if (!m) throw new Error("Only PNG and WebP data URIs are accepted")
  const ext = m[1]
  const buf = Buffer.from(m[2], "base64")

  // Content must match the declared type — rejects spoofed payloads.
  if (!MAGIC[ext]?.(buf)) throw new Error("Image content does not match declared type")

  // Re-encode server-side to strip all EXIF/GPS/XMP metadata. The canvas-based
  // client uploader already strips most metadata, but this is the authoritative
  // sanitization step. All uploads are normalized to WebP.
  let processed: Buffer
  try {
    processed = await sharp(buf)
      .rotate() // auto-orient, consuming any EXIF orientation data
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
  } catch {
    throw new Error("Image could not be sanitized")
  }

  const { url } = await put(`${folder}/${randomBytes(8).toString("hex")}.webp`, processed, {
    access: "public",
    contentType: "image/webp",
  })
  return url
}

/**
 * Delete a single image from Vercel Blob by its URL.
 * No-ops if the token is not configured or the URL is not a real Blob URL.
 * Swallows errors so cleanup failures do not break deletions.
 */
export async function deleteImage(url: string | null | undefined): Promise<void> {
  if (!url || !url.startsWith("https://")) return
  if (!process.env.BLOB_READ_WRITE_TOKEN) return
  try {
    await del(url)
  } catch (error) {
    console.error("Failed to delete blob:", url, error)
  }
}

/**
 * Delete multiple images from Vercel Blob by their URLs.
 */
export async function deleteImages(urls: (string | null | undefined)[]): Promise<void> {
  await Promise.all(urls.filter((u): u is string => typeof u === "string" && u.startsWith("https://")).map(deleteImage))
}

// Models and fields that store Vercel Blob image URLs. Used to verify a Blob
// is no longer referenced before deleting it (shared-image protection).
/**
 * Delete images from Vercel Blob only when no database record references them.
 * Safe for replacement flows and account cleanup where multiple records may
 * have existed for the same user.
 */
export async function deleteImagesIfUnreferenced(urls: (string | null | undefined)[]): Promise<void> {
  const candidates = urls.filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
  if (!candidates.length || !process.env.BLOB_READ_WRITE_TOKEN) return

  const [postImages, diaryImages, setupImages, strainPhotos, contestImages, profiles] = await Promise.all([
    prisma.postImage.findMany({ where: { url: { in: candidates } }, select: { url: true } }),
    prisma.diaryImage.findMany({ where: { url: { in: candidates } }, select: { url: true } }),
    prisma.setupImage.findMany({ where: { url: { in: candidates } }, select: { url: true } }),
    prisma.strainPhoto.findMany({ where: { imageUrl: { in: candidates } }, select: { imageUrl: true } }),
    prisma.contestEntry.findMany({ where: { imageUrl: { in: candidates } }, select: { imageUrl: true } }),
    prisma.profile.findMany({ where: { avatarUrl: { in: candidates } }, select: { avatarUrl: true } }),
  ])

  const inUse = new Set<string>(
    [
      ...postImages.map((i) => i.url),
      ...diaryImages.map((i) => i.url),
      ...setupImages.map((i) => i.url),
      ...strainPhotos.map((i) => i.imageUrl),
      ...contestImages.map((i) => i.imageUrl),
      ...profiles.map((p) => p.avatarUrl),
    ].filter((u): u is string => typeof u === "string")
  )

  await deleteImages(candidates.filter((u) => !inUse.has(u)))
}
