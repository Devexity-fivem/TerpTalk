// Catch up — compact "past week" rollup for returning members.
// Server component: data comes from lib/catch-up.ts (real, authorized,
// bounded). Says "the past week" — never "since your last visit": there
// is no reliable last-visit cursor (lastSeenAt is a presence heartbeat).
import Link from "next/link"
import { Bell, Sprout, MessageSquare, HelpCircle } from "@/lib/icons"
import type { CatchUpData } from "@/lib/catch-up"

export default function CatchUpCard({ data }: { data: CatchUpData }) {
  const has = data.notices.length > 0 || data.followed.length > 0 || data.helpWanted.items.length > 0
  if (!has) return null

  return (
    <section aria-label="Catch up on recent activity" className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 overflow-hidden">
      <div className="p-3.5 border-b border-border flex items-center justify-between gap-3">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          Catch up — the past week
        </h2>
        {data.unreadCount > 0 && (
          <Link href="/notifications" className="text-xs text-primary hover:underline shrink-0">
            {data.unreadCount} unread
          </Link>
        )}
      </div>
      <div className="divide-y divide-border/60">
        {data.notices.length > 0 && (
          <div className="p-3.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> For you
            </p>
            <ul className="space-y-1.5">
              {data.notices.map((n) => (
                <li key={n.id} className="text-sm min-w-0">
                  {n.link ? (
                    <Link href={n.link} className="text-foreground hover:text-primary transition-colors line-clamp-1">
                      {n.title}
                    </Link>
                  ) : (
                    <span className="line-clamp-1">{n.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.followed.length > 0 && (
          <div className="p-3.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Sprout className="w-3.5 h-3.5" /> From growers you follow
            </p>
            <ul className="space-y-1.5">
              {data.followed.map((a) => (
                <li key={a.href} className="text-sm min-w-0">
                  <Link href={a.href} className="text-foreground hover:text-primary transition-colors line-clamp-1">
                    {a.text}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.helpWanted.items.length > 0 && (
          <div className="p-3.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" /> Questions you could answer
            </p>
            <ul className="space-y-1.5">
              {data.helpWanted.items.map((q) => (
                <li key={q.slug} className="text-sm min-w-0">
                  <Link href={`/forum/thread/${q.slug}`} className="text-foreground hover:text-primary transition-colors line-clamp-1">
                    {q.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground line-clamp-1">{q.reasonText}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
