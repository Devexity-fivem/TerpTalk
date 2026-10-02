import Image from "next/image"

/** Vercel Blob *public* store hosts — the only remote images routed
 *  through next/image (see `images.remotePatterns` in next.config.ts).
 *  /api/media proxies, private blobs, data:/blob: URIs, and external
 *  attribution hosts all fall back to a plain <img>. */
const PUBLIC_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com"

export function isPublicBlobImage(src: string): boolean {
  try {
    return new URL(src).hostname.endsWith(PUBLIC_BLOB_HOST_SUFFIX)
  } catch {
    return false
  }
}

type BlobImageProps = {
  src: string
  alt: string
  className?: string
  /** Render mode — mirrors next/image. `fill` requires a sized,
   *  `position:relative` parent; otherwise pass width+height. */
  fill?: boolean
  width?: number
  height?: number
  /** Required with `fill` so the browser picks a sane srcset width —
   *  defaults to `100vw`, which over-fetches for cards/thumbnails. */
  sizes?: string
  priority?: boolean
  /** For decorative images — renders aria-hidden in both modes. */
  ariaHidden?: boolean
}

/** Remote image that optimizes only when the src is a known public
 *  blob host; everything else renders as a normal lazy <img> with the
 *  same styling. Do not use for auth-gated /api/media URLs. */
export default function BlobImage({
  src,
  alt,
  className,
  fill,
  width,
  height,
  sizes,
  priority,
  ariaHidden,
}: BlobImageProps) {
  if (isPublicBlobImage(src) && (fill || (width && height))) {
    return (
      <Image
        src={src}
        alt={alt}
        className={className}
        aria-hidden={ariaHidden}
        {...(fill ? { fill: true, sizes } : { width, height, sizes })}
        priority={priority}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      aria-hidden={ariaHidden}
      className={className}
    />
  )
}
