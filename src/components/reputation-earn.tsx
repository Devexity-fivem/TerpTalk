"use client"

import { MessageSquare, MessageCircle, BookOpen, Camera, Dna, Heart, UserPlus, Repeat, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"
import { REP_POINTS, VERIFIED_MULTIPLIER, VERIFIED_MIN_AGE_DAYS, VERIFIED_MIN_REPUTATION } from "@/lib/reputation-config"
import Tooltip, { InfoTip } from "@/components/ui/tooltip"

const ACTIONS = [
  { key: "DAILY_LOGIN", label: "Daily sesh", icon: Calendar, points: REP_POINTS.DAILY_LOGIN, hint: "Sign in once a day — that's it." },
  { key: "THREAD_CREATED", label: "Start a grow talk", icon: MessageSquare, points: REP_POINTS.THREAD_CREATED, hint: "Create a new discussion thread in the forum." },
  { key: "POST_CREATED", label: "Drop a reply", icon: MessageCircle, points: REP_POINTS.POST_CREATED, hint: "Reply to someone's thread." },
  { key: "DIARY_CREATED", label: "Start a grow diary", icon: BookOpen, points: REP_POINTS.DIARY_CREATED, hint: "Begin a new grow diary to document a run." },
  { key: "DIARY_UPDATE", label: "Log a diary update", icon: Repeat, points: REP_POINTS.DIARY_UPDATE, hint: "Post an update to one of your grow diaries." },
  { key: "STRAIN_CREATED", label: "Add a strain", icon: Dna, points: REP_POINTS.STRAIN_CREATED, hint: "Add a new strain to the community database." },
  { key: "STRAIN_PHOTO", label: "Post a bud shot", icon: Camera, points: REP_POINTS.STRAIN_PHOTO, hint: "Attach a photo to a strain page." },
  { key: "LIKE_RECEIVED", label: "Get a nod", icon: Heart, points: REP_POINTS.LIKE_RECEIVED, hint: "Earned each time another member likes your post or diary." },
  { key: "REFERRAL", label: "Invite a grower", icon: UserPlus, points: REP_POINTS.REFERRAL, hint: "Share your referral link — pays out once your invitee gets established." },
]

export default function ReputationEarn({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("bg-card rounded-lg border border-border p-6", compact && "p-4")}>
      <h3 className={cn("font-semibold mb-4 flex items-center gap-1.5", compact ? "text-base" : "text-lg")}>
        How to earn reputation
        <InfoTip content="Reputation comes from real contributions — posting, journaling, and helping other growers. Hover any action for details." />
      </h3>
      <div className="grid gap-2">
        {ACTIONS.map((a) => (
          <div
            key={a.key}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <a.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <Tooltip content={a.hint} align="start" className="min-w-0">
                <div className="text-sm font-medium">{a.label}</div>
              </Tooltip>
              <div className="text-[10px] text-muted-foreground">
                +{a.points} rep
                {a.key === "LIKE_RECEIVED" ? " per like" : a.key === "REFERRAL" ? " when your invitee gets established" : ""}
              </div>
            </div>
            <Tooltip content={`Earns +${a.points} reputation`} align="end">
              <span className="text-sm font-bold text-amber-500">+{a.points}</span>
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
        <p className="text-sm text-amber-200">
          <span className="font-semibold">Verified growers earn {VERIFIED_MULTIPLIER}x reputation.</span>{" "}
          Reach {VERIFIED_MIN_REPUTATION.toLocaleString()} rep and stay active for {VERIFIED_MIN_AGE_DAYS} days to become verified automatically.
        </p>
      </div>
    </div>
  )
}
