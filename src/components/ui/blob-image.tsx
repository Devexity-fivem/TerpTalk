import Image from "next/image"

/** True only for URLs on our own public Blob store host — the one
 *  `images.remotePatterns` allows through next/image (next.config.ts
 *  derives it from BLOB_STORE_ID and inlines it here as
 *  NEXT_PUBLIC_BLOB_PUBLIC_HOST). Empty locally/CI, unparseable URLs,
 *  /api/media proxies, private blobs, data:/blob: URIs, and external
 *  attribution hosts all fall back to a plain <img>. */
export function isPublicBlobImage(src: string): boolean {
  const host = process.env.NEXT_PUBLIC_BLOB_PUBLIC_HOST
  if (!host) return false
  try {
    return new URL(src).hostname === host
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
