"use client"

import { MessageSquare, MessageCircle, BookOpen, Camera, Dna, Heart, UserPlus, Repeat, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"
import { REP_POINTS, VERIFIED_MULTIPLIER } from "@/lib/reputation-config"

const ACTIONS = [
  { key: "DAILY_LOGIN", label: "Check in daily", icon: Calendar, points: REP_POINTS.DAILY_LOGIN },
  { key: "THREAD_CREATED", label: "Start a discussion", icon: MessageSquare, points: REP_POINTS.THREAD_CREATED },
  { key: "POST_CREATED", label: "Reply or comment", icon: MessageCircle, points: REP_POINTS.POST_CREATED },
  { key: "DIARY_CREATED", label: "Start a grow diary", icon: BookOpen, points: REP_POINTS.DIARY_CREATED },
  { key: "DIARY_UPDATE", label: "Post a diary update", icon: Repeat, points: REP_POINTS.DIARY_UPDATE },
  { key: "STRAIN_CREATED", label: "Add a strain", icon: Dna, points: REP_POINTS.STRAIN_CREATED },
  { key: "STRAIN_PHOTO", label: "Share a photo", icon: Camera, points: REP_POINTS.STRAIN_PHOTO },
  { key: "LIKE_RECEIVED", label: "Receive a like", icon: Heart, points: REP_POINTS.LIKE_RECEIVED },
  { key: "REFERRAL", label: "Invite a grower", icon: UserPlus, points: REP_POINTS.REFERRAL },
]

export default function ReputationEarn({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("bg-card rounded-lg border border-border p-6", compact && "p-4")}>
      <h3 className={cn("font-semibold mb-4", compact ? "text-base" : "text-lg")}>How to earn reputation</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {ACTIONS.map((a) => (
          <div
            key={a.key}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <a.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{a.label}</div>
              <div className="text-[10px] text-muted-foreground">
                +{a.points} rep
                {a.key === "LIKE_RECEIVED" ? " per like" : a.key === "REFERRAL" ? " per signup" : ""}
              </div>
            </div>
            <span className="text-sm font-bold text-amber-500">+{a.points}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
        <p className="text-sm text-amber-200">
          <span className="font-semibold">Verified members earn {VERIFIED_MULTIPLIER}x reputation.</span>{" "}
          Reach 1,500 rep and stay active for 7 days to become verified automatically.
        </p>
      </div>
    </div>
  )
}
