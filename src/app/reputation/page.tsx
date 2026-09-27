import { XP_TABLE, REP_RANKS, RANK_DISPLAY, PROGRESSION_RUNGS, STANDINGS, STANDING_DISPLAY, REFERRAL_MIN_XP, REFERRAL_MIN_AGE_HOURS } from "@/lib/progression-config"
import { WEEKLY_CHALLENGES } from "@/lib/challenges"
import { TrendingUp, ShieldCheck, RotateCcw, Sprout, Target } from "lucide-react"
import ProgressionPanel from "@/components/progression-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Progression",
  description: "How XP, ranks, grow stages, standing, and badges work in the TerpTalk community.",
}

// Member-facing earning catalog — a curated subset of the XP table, in
// display order. Standing-bearing awards are labeled so members can tell
// peer-validated standing from regular XP.
const SOURCES: Array<{ key: keyof typeof XP_TABLE; label: string; note: string }> = [
  { key: "ACCEPTED_ANSWER", label: "Answer accepted", note: "The thread author marks your reply as the solution." },
  { key: "SUBSTANTIVE_ANSWER", label: "Give a substantive answer", note: "Real answers, not one-liners." },
  { key: "THREAD_STARTED", label: "Start a thread", note: "The first few threads each day count." },
  { key: "REPLY", label: "Reply in the forums", note: "Meaningful replies, not volume." },
  { key: "DIARY_CREATED", label: "Start a grow diary", note: "Document a full grow." },
  { key: "UPDATE_DAY", label: "Post a diary update", note: "Once per diary per day — say something real." },
  { key: "SETUP_SHOWCASE", label: "Share a grow setup", note: "Show off your tent, lights, and gear." },
  { key: "STRAIN_SOURCED", label: "Add a sourced strain", note: "Contribute to the strain knowledge base." },
  { key: "STRAIN_PHOTO", label: "Share a strain photo", note: "Real photos of real grows." },
  { key: "GUIDE_PUBLISHED", label: "Publish a guide", note: "Write a community guide — pays XP and standing." },
  { key: "OP_CURATION", label: "Mark an accepted answer", note: "Curate your own thread — requires another member's answer." },
  { key: "HARVEST_LOGGED", label: "Log a harvest", note: "Finish a documented grow — once per diary, needs real updates." },
  { key: "ONBOARDING_COMPLETE", label: "Finish onboarding", note: "A one-time welcome to the community." },
  { key: "REFERRAL", label: "Refer a member", note: `Pays out once your invitee earns ${REFERRAL_MIN_XP} XP and has been a member for ${REFERRAL_MIN_AGE_HOURS}+ hours.` },
  { key: "CONTEST_WEEKLY_WIN", label: "Win Budshot of the Week", note: "Weekly community photo contest." },
  { key: "CONTEST_MONTHLY_WIN", label: "Win Diary of the Month", note: "Monthly grow diary contest." },
]

export default function ProgressionPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <Sprout className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">Grow your rank</h1>
          <p className="text-muted-foreground">
            XP is your garden. You start as a seed — contribute, help other growers,
            document your grows — and your profile grows with you.
          </p>
        </div>

        <ProgressionPanel />

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Ways to grow</h2>
          </div>
          <div className="space-y-2">
            {SOURCES.map((s) => {
              const spec = XP_TABLE[s.key]
              return (
                <div key={s.key} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.note}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-semibold text-primary">+{spec.xp} XP</span>
                    {spec.standing ? (
                      <div className="text-[10px] text-muted-foreground">+{spec.standing} standing</div>
                    ) : (spec.dailyCap || spec.weeklyCap) ? (
                      <div className="text-[10px] text-muted-foreground">{spec.dailyCap ? "daily" : "weekly"} limit applies</div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
            Every award lands in one of five mastery paths — Cultivation, Records, Knowledge,
            Experimentation, and Community — so how you contribute shapes your profile, not just
            how much. Higher ranks also require breadth: diversify your paths to keep climbing.
          </p>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Standing</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Standing is separate from XP — it only grows through peer-validated work: accepted
            answers, published guides, qualified referrals, and contest wins. It can&apos;t be
            farmed alone, and it gates community privileges like links in posts, polls, and
            slowmode exemption.
          </p>
          <div className="space-y-1.5">
            {STANDINGS.map((s) => (
              <div key={s.name} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-xs font-medium shrink-0">{STANDING_DISPLAY[s.name].icon} {s.name}</span>
                <span className="text-muted-foreground text-xs w-14 shrink-0">{s.min.toLocaleString()}+</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Quests &amp; challenges</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Every day you get a few small quests — reply somewhere, tend a diary, help a
            newcomer. Higher ranks unlock extra quest slots. They reset at midnight UTC
            and missed ones just expire. Below are the weekly challenges: optional goals that reset
            every Monday. Ignore all of it freely — they reward things you&apos;d do anyway.
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
                <span className="font-semibold text-primary shrink-0">+{c.reward} XP</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <h2 className="font-display text-lg font-semibold mb-1">The Path to Master Cultivator</h2>
          <p className="text-xs text-muted-foreground mb-3">
            {REP_RANKS.length} ranks, {PROGRESSION_RUNGS.length} rungs total — every rank unlocks something
            real: chat rooms, quest slots, better tools, and Garden Perks. Grow stages in between keep you
            moving. Check in daily to build your garden streak — milestones land at 3, 7, 14,
            30, 60, 100, and 365 days.
          </p>
          <div className="space-y-2">
            {REP_RANKS.map((r) => {
              const d = RANK_DISPLAY[r.name] ?? RANK_DISPLAY.Seed
              return (
                <div key={r.name} className="flex items-center gap-3 text-sm">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${d.bg} ${d.color} text-xs font-medium w-32 justify-center shrink-0`}>
                    <span>{d.icon}</span> {r.name}
                  </span>
                  <span className="text-muted-foreground text-xs w-16 shrink-0">{r.threshold.toLocaleString()} XP</span>
                  <span className="text-xs text-muted-foreground min-w-0">{d.benefit}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <h2 className="font-display text-lg font-semibold mb-1">Garden Perks</h2>
          <p className="text-xs text-muted-foreground">
            Ranks and streaks unlock real things, not decorations. Reach Harvested rank — or keep a
            60-day check-in streak — and you can pin your proudest harvest to the top of your profile.
            At Cured rank or a 100-day streak your active grow can be featured in the Grower Spotlight
            on the home page. And from Rooted rank up, partner deals on the deals page open to members —
            the best offers wait for the most experienced growers.
          </p>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Fair play</h2>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>You can&apos;t earn XP from your own content or from TerpBot.</li>
            <li>XP from deleted or removed content is reversed automatically.</li>
            <li>Standing has weekly caps and anti-clustering rules — it only counts when it comes from real, varied peers.</li>
            <li>Automated, coordinated, or inauthentic XP farming is flagged for moderator review.</li>
            <li>Every award has a reason — your profile shows a public history of what you earned.</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Reversed awards stay visible in your history, struck through.
          </p>
        </div>
      </div>
    </div>
  )
}
