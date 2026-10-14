// StoryRail — horizontal strip of authors with active 24h stories,
// rendered at the top of the feed. Pure server component: entries come
// from getStoryRail(), which already applies visibility and blocks.
import Link from "next/link"
import { Camera } from "@/lib/icons"
import type { StoryRailEntry } from "@/lib/moments"

export default function StoryRail({ entries }: { entries: StoryRailEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="mb-6 -mx-1 px-1" aria-label="Stories">
      <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1">
        {entries.map((e) => {
          const username = e.author.profile?.username ?? e.author.name ?? "member"
          return (
            <Link
              key={e.author.id}
              href={`/stories/${username}`}
              className="shrink-0 w-20 flex flex-col items-center gap-1.5 group"
              aria-label={`${username}'s story`}
            >
              <span className="relative block w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-primary via-primary/60 to-spectrum">
                <span className="block w-full h-full rounded-full overflow-hidden border-2 border-background bg-secondary">
                  {e.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center bg-primary/10">
                      {e.author.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.author.image} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <Camera className="w-5 h-5 text-primary" />
                      )}
                    </span>
                  )}
                </span>
                {e.count > 1 && (
                  <span className="absolute -bottom-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center border-2 border-background">
                    {e.count}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground group-hover:text-foreground truncate w-full text-center">
                {username}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
