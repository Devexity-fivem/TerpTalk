"use client"

import { MessageSquare, MessageCircle, BookOpen, Camera, CheckCircle, UserPlus, Repeat, Trophy, FlaskConical } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { XP_TABLE } from "@/lib/progression-config"
import Tooltip, { InfoTip } from "@/components/ui/tooltip"

const ACTIONS = [
  { key: "THREAD_STARTED", label: "Start a grow talk", icon: MessageSquare, hint: "Create a new discussion thread in the forum." },
  { key: "REPLY", label: "Drop a reply", icon: MessageCircle, hint: "Reply to someone's thread." },
  { key: "SUBSTANTIVE_ANSWER", label: "Answer a question", icon: MessageCircle, hint: "Give a substantive answer in a questions thread." },
  { key: "ACCEPTED_ANSWER", label: "Get accepted", icon: CheckCircle, hint: "The asker marked your answer as the solution — pays XP and standing." },
  { key: "DIARY_CREATED", label: "Start a grow diary", icon: BookOpen, hint: "Begin a new grow diary to document a run." },
  { key: "UPDATE_DAY", label: "Log a diary update", icon: Repeat, hint: "Post an update to one of your grow diaries." },
  { key: "STRAIN_PHOTO", label: "Post a bud shot", icon: Camera, hint: "Attach a photo to a strain page." },
  { key: "EXPERIMENT_CREATED", label: "Log an experiment", icon: FlaskConical, hint: "Document an experiment on one of your grows — finishing it pays more." },
  { key: "CONTEST_ENTRY", label: "Enter a contest", icon: Trophy, hint: "Submit a budshot or a diary to a community contest." },
  { key: "CONTEST_WEEKLY_WIN", label: "Win the weekly contest", icon: Trophy, hint: "Take first place in the weekly photo contest." },
  { key: "REFERRAL", label: "Invite a grower", icon: UserPlus, hint: "Share your referral link — pays out once your invitee gets established." },
]

export default function ReputationEarn({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("bg-card/80 rounded-2xl border border-border/70 p-6", compact && "p-4")}>
      <h3 className={cn("font-semibold mb-4 flex items-center gap-1.5", compact ? "text-base" : "text-lg")}>
        How to earn XP
        <InfoTip content="XP comes from real contributions — posting, journaling, and helping other growers. Hover any action for details." />
      </h3>
      <div className="grid gap-2">
        {ACTIONS.map((a) => {
          const spec = XP_TABLE[a.key]
          if (!spec) return null
          return (
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
                  +{spec.xp} XP
                  {spec.standing ? ` · +${spec.standing} standing` : ""}
                  {a.key === "REFERRAL" ? " when your invitee gets established" : ""}
                </div>
              </div>
              <Tooltip content={`Earns +${spec.xp} XP`} align="end">
                <span className="text-sm font-bold text-warning">+{spec.xp}</span>
              </Tooltip>
            </div>
          )
        })}
      </div>
      <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
        <p className="text-sm text-warning">
          <span className="font-semibold">Standing is earned, not farmed.</span>{" "}
          Peer-gated contributions — accepted answers, qualified referrals — build the standing that unlocks community privileges.
        </p>
      </div>
    </div>
  )
}
