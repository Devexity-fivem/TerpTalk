// Vercel Blob storage for user-uploaded images.
// Accepts client-resized data URIs; stores them in Blob and returns a
// small https URL so DB rows stay tiny. Falls back to the data URI when
// BLOB_READ_WRITE_TOKEN isn't configured so nothing breaks locally.
import { put } from "@vercel/blob"
import { randomBytes } from "crypto"

const DATA_URI = /^data:image\/(png|jpe?g|webp);base64,(.+)$/
export const MAX_DATA_URI_LEN = 400_000 // ~300KB binary

export function isValidImageDataUri(s: unknown): s is string {
  return typeof s === "string" && DATA_URI.test(s) && s.length <= MAX_DATA_URI_LEN
}

// Verify actual file signatures — don't trust the declared MIME type.
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  jpg: (b) => MAGIC.jpeg(b),
  webp: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
}

export async function storeImage(dataUri: string, folder: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUri // graceful fallback

  const m = dataUri.match(DATA_URI)
  if (!m) return dataUri
  const ext = m[1] === "jpeg" ? "jpg" : m[1]
  const buf = Buffer.from(m[2], "base64")

  // Content must match the declared type — rejects spoofed payloads.
  // Fallback keeps it as a data URI (img-src data: can't execute for
  // raster types; SVG is already blocked by the DATA_URI regex).
  if (!MAGIC[ext]?.(buf)) return dataUri

  const { url } = await put(`${folder}/${randomBytes(8).toString("hex")}.${ext}`, buf, {
    access: "public",
    contentType: `image/${m[1]}`,
  })
  return url
}
