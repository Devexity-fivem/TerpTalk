"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Sprout, MessageSquare, CheckCircle2, X, ArrowRight,
  BookOpen, HelpCircle, PenLine,
} from "@/lib/icons"
import SuggestedGrowerCard from "@/components/suggested-grower-card"
import type { SuggestedGrower } from "@/lib/suggested-growers"

// First-session activation panel — "Start your grow journey". Progress
// is server-derived from real durable activity (activationMilestonesFor)
// and never written client-side: a re-render after a real action simply
// shows the next milestone. Dismiss persists via POST /api/activation/
// dismiss; CTA clicks fire an ACTIVATION_CTA product event (an attempt
// signal — completions live in the activation funnel, not here).

export interface ActivationPanelProps {
  completed: { people: boolean; grow: boolean; conversation: boolean }
  next: "people" | "grow" | "conversation"
  /** Top grower suggestions for the people milestone (server-provided). */
  growers: SuggestedGrower[]
  /** /forum/new?category=<slug> when a question category exists. */
  askHref: string
  /** Diary href for "Log a grow update" when the member has an active grow. */
  updateHref: string | null
}

function fireCta(milestone: "people" | "grow" | "conversation") {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "ACTIVATION_CTA", source: "member_home", objectType: milestone }),
  }).catch(() => {})
}

export default function ActivationPanel({ completed, next, growers, askHref, updateHref }: ActivationPanelProps) {
  const [hidden, setHidden] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const dismiss = () => {
    if (dismissing) return
    setDismissing(true)
    setHidden(true)
    fetch("/api/activation/dismiss", { method: "POST" }).catch(() => {
      // Non-fatal — the panel hides optimistically; a missed write just
      // re-shows it on the next visit, it never blocks the member.
    })
  }

  if (hidden) return null

  const doneCount = (completed.people ? 1 : 0) + (completed.grow ? 1 : 0) + (completed.conversation ? 1 : 0)

  const milestoneHead = (done: boolean, title: string) => (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Done" />
      ) : (
        <span className="h-4 w-4 shrink-0 rounded-full border-2 border-primary/50" aria-hidden="true" />
      )}
      <span className={`text-sm font-medium ${done ? "text-muted-foreground" : ""}`}>{title}</span>
    </div>
  )

  return (
    <section aria-label="Start your grow journey" className="tt-spotlight overflow-hidden rounded-2xl border border-primary/25 bg-card/80">
      <div className="flex items-start justify-between gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
            <Sprout className="h-4 w-4 text-primary" />
            Start your grow journey
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Three small steps to get rooted — in any order, whenever you&apos;re ready.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{doneCount} of 3</span>
          <button
            type="button"
            onClick={dismiss}
            disabled={dismissing}
            aria-label="Dismiss activation guide"
            className="tap-target rounded-lg p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mx-4 h-1 overflow-hidden rounded-full bg-secondary sm:mx-5" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / 3) * 100}%` }} />
      </div>
      <ul className="space-y-3 p-4 pt-3 sm:p-5 sm:pt-3">
        {/* 1 — Find your people */}
        <li>
          {milestoneHead(completed.people, "Find your people")}
          {!completed.people && (
            <div className="mt-2 space-y-2 pl-6">
              <p className="text-xs text-muted-foreground">
                Follow a grower — their grows and posts fill your feed.
              </p>
              {growers.slice(0, 2).map((g) => (
                <SuggestedGrowerCard key={g.userId} grower={g} source="member_home" />
              ))}
              <Link
                href="/growers"
                onClick={() => fireCta("people")}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Browse growers <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </li>

        {/* 2 — Start your grow record */}
        <li>
          {milestoneHead(completed.grow, "Start your grow record")}
          {!completed.grow && (
            <div className="mt-2 space-y-2 pl-6">
              <p className="text-xs text-muted-foreground">
                A diary documents your grow and unlocks tailored guidance.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/diaries/new"
                  onClick={() => fireCta("grow")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <BookOpen className="h-3.5 w-3.5" /> Start a diary
                </Link>
                {updateHref && (
                  <Link
                    href={updateHref}
                    onClick={() => fireCta("grow")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                  >
                    <PenLine className="h-3.5 w-3.5" /> Log an update
                  </Link>
                )}
              </div>
            </div>
          )}
        </li>

        {/* 3 — Join the conversation */}
        <li>
          {milestoneHead(completed.conversation, "Join the conversation")}
          {!completed.conversation && (
            <div className="mt-2 space-y-2 pl-6">
              <p className="text-xs text-muted-foreground">
                Ask, share, or reply — any real contribution counts.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={askHref}
                  onClick={() => fireCta("conversation")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <HelpCircle className="h-3.5 w-3.5" /> Ask a question
                </Link>
                <Link
                  href="/forum/new"
                  onClick={() => fireCta("conversation")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Start a discussion
                </Link>
                {updateHref && (
                  <Link
                    href={updateHref}
                    onClick={() => fireCta("conversation")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                  >
                    <PenLine className="h-3.5 w-3.5" /> Log a grow update
                  </Link>
                )}
              </div>
            </div>
          )}
        </li>
      </ul>
      {next && <span className="sr-only">Next suggested step: {next}</span>}
    </section>
  )
}
