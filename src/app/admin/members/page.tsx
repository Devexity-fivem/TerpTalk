import { notFound } from "next/navigation"
import Link from "next/link"
import { requireStaff } from "@/lib/require-staff"
import { isAdmin } from "@/lib/security"
import { searchMembers } from "@/lib/ops-metrics"
import { Search } from "lucide-react"

export const dynamic = "force-dynamic"

function fmtAge(d: Date | null) {
  if (!d) return "never"
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000)
  if (h < 1) return "<1h ago"
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Member explorer — staff-level administrative lookup. Shows account state,
// contribution counts, and trust signals only: no email, no bio, no private
// content. Moderation context deep-links into the existing queue.
export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const staff = await requireStaff()
  if (!staff) notFound()
  const admin = isAdmin(staff.role)
  const { q } = await searchParams
  const results = q ? await searchMembers(q) : []

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Members</h1>
        <p className="text-sm text-muted-foreground">Administrative member lookup — status, activity counts, trust signals.</p>
      </div>

      <form method="GET" action="/admin/members" className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search username (min 2 chars)"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium">Search</button>
      </form>

      {q && (
        <section className="rounded-2xl border border-border/60 bg-card/40">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No members match “{q}”.</p>
          ) : (
            <ul className="divide-y divide-border/50">
              {results.map((m) => (
                <li key={m.id} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/u/${m.username}`} className="font-medium hover:text-primary">@{m.username}</Link>
                      {m.role !== "MEMBER" && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 text-blue-500 rounded font-semibold">{m.role}</span>
                      )}
                      {m.banned && <span className="text-[10px] px-1.5 py-0.5 bg-destructive/15 text-destructive rounded font-semibold">BANNED</span>}
                      {m.suspendedUntil && m.suspendedUntil > new Date() && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-warning/15 text-warning rounded font-semibold">SUSPENDED</span>
                      )}
                      {!m.onboardingCompleted && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded font-semibold">ONBOARDING INCOMPLETE</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      joined {m.createdAt.toLocaleDateString()} · last seen {fmtAge(m.lastSeenAt)} · rep {m.reputation}
                      {m.referred ? " · referred" : ""}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {m.counts.threads} threads · {m.counts.posts} replies · {m.counts.diaries} diaries · {m.counts.diaryUpdates} updates · {m.counts.chatMessages} chat · {m.counts.setups} setups
                    </div>
                    {(m.openReportsAbout > 0 || m.abuseFlags > 0) && (
                      <div className="text-xs text-warning mt-0.5">
                        {m.openReportsAbout} open reports · {m.abuseFlags} abuse flags
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Link href="/moderation" className="px-3 py-1.5 text-xs bg-secondary rounded-lg hover:bg-secondary/80">
                      Moderation
                    </Link>
                    {admin && (
                      <Link href={`/admin/users/${m.id}`} className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20">
                        Manage
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!q && (
        <p className="text-sm text-muted-foreground">
          Search returns at most 25 members with status and contribution counts. For a full moderation dossier
          use the lookup inside <Link href="/moderation" className="text-primary hover:underline">Moderation</Link>.
        </p>
      )}
    </main>
  )
}
