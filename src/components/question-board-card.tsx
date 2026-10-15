// Needs answers — compact board of real questions still seeking one.
// Server component fed by lib/question-board.ts: signed-in members see
// public-evidence matches first (with the explainable reason), everyone
// sees the general open pool. Empty → renders nothing.
import Link from "next/link"
import { HelpCircle, MessageSquare, ArrowRight } from "@/lib/icons"
import { sanitizeEcho } from "@/lib/terpbot"
import type { QuestionBoardData } from "@/lib/question-board"

export default function QuestionBoardCard({ data }: { data: QuestionBoardData }) {
  const has = data.matched.length > 0 || data.open.length > 0
  if (!has) return null

  return (
    <section aria-label="Questions needing answers" className="tt-spotlight bg-card/80 rounded-2xl border border-border/70 overflow-hidden">
      <div className="p-3.5 border-b border-border flex items-center justify-between gap-3">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-primary" />
          Needs answers
        </h2>
        <Link href="/questions" className="text-xs font-medium text-primary hover:underline shrink-0 inline-flex items-center gap-0.5">
          All questions <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="divide-y divide-border/60">
        {data.matched.length > 0 && (
          <div className="p-3.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Matched to your public grows
            </p>
            <ul className="space-y-1.5">
              {data.matched.map((q) => (
                <li key={q.slug} className="text-sm min-w-0">
                  <Link href={`/forum/thread/${q.slug}`} className="text-foreground hover:text-primary transition-colors line-clamp-1">
                    {q.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground line-clamp-1">
                    {q.category} · {q.reasonText}
                  </span>
                </li>
              ))}
            </ul>
            {data.matchedTotal > data.matched.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                +{data.matchedTotal - data.matched.length} more on{" "}
                <Link href="/questions" className="text-primary hover:underline">Grow Questions</Link>
              </p>
            )}
          </div>
        )}
        {data.open.length > 0 && (
          <div className="p-3.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Open questions
            </p>
            <ul className="space-y-1.5">
              {data.open.map((q) => (
                <li key={q.slug} className="text-sm min-w-0">
                  <Link href={`/forum/thread/${q.slug}`} className="text-foreground hover:text-primary transition-colors line-clamp-1">
                    {q.title}
                  </Link>
                  <span className="block text-xs text-muted-foreground line-clamp-1">
                    {sanitizeEcho(q.authorName, 24)} · {q.category} ·{" "}
                    {q.status === "unanswered"
                      ? "awaiting first reply"
                      : `${q.replyCount} ${q.replyCount === 1 ? "reply" : "replies"}, no accepted answer`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
