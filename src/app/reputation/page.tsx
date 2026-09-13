import { REP_POINTS, REP_CAPS, REP_TIERS, REP_LADDER, VERIFIED_MULTIPLIER, REFERRAL_MIN_REP } from "@/lib/reputation-config"
import { AVATAR_FRAMES, PROFILE_TITLES, PROFILE_THEMES } from "@/lib/cosmetics"
import { WEEKLY_CHALLENGES } from "@/lib/challenges"
import { TrendingUp, ShieldCheck, RotateCcw, Sprout, Target } from "lucide-react"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Reputation",
  description: "How reputation, tiers, grow stages, and badges work in the TerpTalk community.",
}

const SOURCES: Array<{ key: keyof typeof REP_POINTS; label: string; note: string }> = [
  { key: "HELPFUL_ANSWER", label: "Answer accepted", note: "The thread author marks your reply as the solution." },
  { key: "THREAD_CREATED", label: "Start a thread", note: "The first few threads each day count." },
  { key: "POST_CREATED", label: "Reply in the forums", note: "Meaningful replies, not volume." },
  { key: "DIARY_CREATED", label: "Start a grow diary", note: "Document a full grow." },
  { key: "DIARY_UPDATE", label: "Post a diary update", note: "Once per diary per day — say something real." },
  { key: "SETUP_CREATED", label: "Share a grow setup", note: "Show off your tent, lights, and gear." },
  { key: "STRAIN_CREATED", label: "Add a strain", note: "Contribute to the strain knowledge base." },
  { key: "STRAIN_PHOTO", label: "Share a strain photo", note: "Real photos of real grows — on strains others added." },
  { key: "LIKE_RECEIVED", label: "Receive a like", note: "Each member can only reward a post once — ever." },
  { key: "REFERRAL", label: "Refer a member", note: `Pays out once your invitee earns ${REFERRAL_MIN_REP} rep on their own.` },
  { key: "CONTEST_WEEKLY_WIN", label: "Win Budshot of the Week", note: "Weekly community photo contest." },
  { key: "CONTEST_MONTHLY_WIN", label: "Win Diary of the Month", note: "Monthly grow diary contest." },
]

export default function ReputationPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <Sprout className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold mb-2">Grow your reputation</h1>
          <p className="text-muted-foreground">
            Reputation is your garden. You start as a seed — contribute, help other growers,
            document your grows — and your profile grows with you.
          </p>
        </div>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Ways to grow</h2>
          </div>
          <div className="space-y-2">
            {SOURCES.map((s) => (
              <div key={s.key} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.note}</div>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-semibold text-primary">+{REP_POINTS[s.key]}</span>
                  {REP_CAPS[s.key] != null && (
                    <div className="text-[10px] text-muted-foreground">daily limit applies</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
            Verified members earn a {Math.round((VERIFIED_MULTIPLIER - 1) * 100)}% bonus on every award.
            When you&apos;ve earned all the rep available from an activity today, try another way to grow.
          </p>
        </div>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Weekly challenges</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Optional goals that reset every Monday. Ignore them freely — they reward things you&apos;d do anyway.
          </p>
          <div className="space-y-2">
            {WEEKLY_CHALLENGES.map((c) => (
              <div key={c.slug} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-base">{c.icon}</span>
                  <div>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground">{c.description}</div>
                  </div>
                </div>
                <span className="font-semibold text-primary shrink-0">+{c.reward}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <h2 className="text-lg font-semibold mb-1">The ladder</h2>
          <p className="text-xs text-muted-foreground mb-3">
            {REP_LADDER.length} rungs total — tiers unlock the big rewards, grow stages in between keep you moving.
          </p>
          <div className="space-y-2">
            {REP_TIERS.map((t) => (
              <div key={t.name} className="flex items-center gap-3 text-sm">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${t.bg} ${t.color} text-xs font-medium w-32 justify-center shrink-0`}>
                  <span>{t.icon}</span> {t.name}
                </span>
                <span className="text-muted-foreground text-xs w-16 shrink-0">{t.threshold.toLocaleString()} rep</span>
                <span className="text-xs text-muted-foreground min-w-0">{t.benefit}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3">Unlockable rewards</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Avatar frames</h3>
              <div className="flex flex-wrap gap-2">
                {AVATAR_FRAMES.map((f) => (
                  <span key={f.key} title={`${f.description} — unlocks at ${f.unlockedAt.toLocaleString()} rep`} className="inline-flex items-center gap-1.5 text-xs bg-secondary/50 rounded-full px-2.5 py-1">
                    <span className={`inline-block w-3.5 h-3.5 rounded-full ${f.className.split(" ").filter((c) => c.startsWith("ring")).join(" ")}`} />
                    {f.name}
                    <span className="text-muted-foreground">{f.unlockedAt.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Profile titles</h3>
              <div className="flex flex-wrap gap-2">
                {PROFILE_TITLES.map((t) => (
                  <span key={t.key} title={`${t.description} — unlocks at ${t.unlockedAt.toLocaleString()} rep`} className="text-xs bg-secondary/50 rounded-full px-2.5 py-1">
                    {t.name} <span className="text-muted-foreground">{t.unlockedAt.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-2">Profile themes</h3>
              <div className="flex flex-wrap gap-2">
                {PROFILE_THEMES.map((t) => (
                  <span key={t.key} title={`${t.description} — unlocks at ${t.unlockedAt.toLocaleString()} rep`} className="text-xs bg-secondary/50 rounded-full px-2.5 py-1">
                    {t.name} <span className="text-muted-foreground">{t.unlockedAt.toLocaleString()}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Fair play</h2>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>You can&apos;t earn reputation from your own content or from TerpBot.</li>
            <li>Reputation from deleted or removed content is reversed automatically.</li>
            <li>Farming patterns (alt accounts, vote rings, rapid-fire likes) are flagged for moderator review.</li>
            <li>Every point has a reason — your profile shows a public history of what you earned.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Reversed awards stay visible in your history, struck through.
          </p>
        </div>
      </div>
    </div>
  )
}
