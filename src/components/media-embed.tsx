import { cn } from "@/lib/utils"

const YOUTUBE_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
const VIMEO_RE = /vimeo\.com\/(\d+)/

function getVideoId(url: string): { provider: "youtube" | "vimeo"; id: string } | null {
  const y = url.match(YOUTUBE_RE)
  if (y?.[1]) return { provider: "youtube", id: y[1] }
  const v = url.match(VIMEO_RE)
  if (v?.[1]) return { provider: "vimeo", id: v[1] }
  return null
}

interface MediaEmbedProps {
  url: string
  className?: string
}

export default function MediaEmbed({ url, className }: MediaEmbedProps) {
  const video = getVideoId(url)
  if (!video) return <a href={url} className="text-primary hover:underline break-words" target="_blank" rel="noopener noreferrer">{url}</a>

  const src =
    video.provider === "youtube"
      ? `https://www.youtube-nocookie.com/embed/${video.id}`
      : `https://player.vimeo.com/video/${video.id}`

  return (
    <div className={cn("my-4", className)}>
      <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border bg-secondary">
        <iframe
          src={src}
          title="Embedded video"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation"
          className="absolute inset-0 w-full h-full"
        />
      </div>
    </div>
  )
}

export const EMBED_RE = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}|https?:\/\/(?:www\.)?vimeo\.com\/\d+)/g
