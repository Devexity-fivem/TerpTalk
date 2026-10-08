import Link from "next/link"
import ProfileCard from "@/components/ui/profile-card"
import RoleBadge from "@/components/role-badge"
import GrowerFollowButton from "@/components/grower-follow-button"
import type { SuggestedGrower } from "@/lib/suggested-growers"

// One suggested-grower card: avatar/identity → profile, honest reason
// lines, public contribution counts, Follow action. Server-renderable —
// the only client island is the follow toggle.
export default function SuggestedGrowerCard({
  grower,
  onFollowToggle,
}: {
  grower: SuggestedGrower
  /** Optional observer — used by onboarding to count first follows. */
  onFollowToggle?: (following: boolean) => void
}) {
  const meta: string[] = []
  if (grower.publicGrows > 0) meta.push(`${grower.publicGrows} public grow${grower.publicGrows === 1 ? "" : "s"}`)
  if (grower.harvests > 0) meta.push(`${grower.harvests} harvest${grower.harvests === 1 ? "" : "s"}`)
  if (grower.acceptedAnswers > 0) meta.push(`${grower.acceptedAnswers} accepted answer${grower.acceptedAnswers === 1 ? "" : "s"}`)

  return (
    <div className="tt-spotlight flex gap-3 p-4 bg-secondary/30 rounded-2xl border border-border/70 tt-edge-card">
      <Link href={grower.href} className="min-w-0 flex-1 group">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ProfileCard
            username={grower.username}
            name={grower.username || grower.name}
            avatarUrl={grower.image}
            xp={grower.xp}
            publicMilestoneOptOut={grower.publicMilestoneOptOut}
            size="sm"
            linked={false}
          />
          <RoleBadge role={grower.role} />
        </div>
        {grower.bio && <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{grower.bio}</p>}
        {grower.reasons.length > 0 && (
          <p className="mt-1 text-xs text-primary/90 font-medium">
            {grower.reasons.map((r) => r.label).join(" · ")}
          </p>
        )}
        {meta.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{meta.join(" · ")}</p>}
      </Link>
      <div className="shrink-0 self-start">
        <GrowerFollowButton userId={grower.userId} username={grower.username} onToggle={onFollowToggle} />
      </div>
    </div>
  )
}
