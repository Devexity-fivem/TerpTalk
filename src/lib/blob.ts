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

export async function storeImage(dataUri: string, folder: string): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return dataUri // graceful fallback

  const m = dataUri.match(DATA_URI)
  if (!m) return dataUri
  const ext = m[1] === "jpeg" ? "jpg" : m[1]
  const buf = Buffer.from(m[2], "base64")

  const { url } = await put(`${folder}/${randomBytes(8).toString("hex")}.${ext}`, buf, {
    access: "public",
    contentType: `image/${m[1]}`,
  })
  return url
}
