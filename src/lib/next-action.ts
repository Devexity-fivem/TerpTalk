import type { JourneyState } from "@/lib/journeys"
import { diaryPath } from "@/lib/slugs"

export interface NextAction {
  icon: string
  text: string
  href: string
  cta: string
}

// Deterministic rule list — highest-value gap wins. The order is the
// product decision: guided journey first for new members, then real grow
// documentation, then tier proximity, then a daily quest, then helping
// another grower. Shared by /api/progression and the member homepage.
export function pickNextAction(input: {
  journey: JourneyState | null
  rep: number
  nextTier: { name: string; threshold: number } | null
  staleDiary: { id: string; slug: string | null; title: string } | null
  quests: { title: string; done: boolean; paid: boolean }[]
}): NextAction {
  const { journey, rep, nextTier, staleDiary, quests } = input

  if (journey && !journey.complete) {
    const step = journey.steps.find((s) => !s.done)
    if (step) {
      return {
        icon: step.icon,
        text: `${step.title} — ${journey.name}, step ${journey.doneCount + 1} of ${journey.steps.length}`,
        href: step.href,
        cta: step.cta,
      }
    }
  }
  if (staleDiary) {
    return {
      icon: "📓",
      text: `"${staleDiary.title.slice(0, 40)}" hasn't been updated in a few days — log what changed`,
      href: diaryPath(staleDiary),
      cta: "Add an update",
    }
  }
  if (nextTier) {
    const remaining = nextTier.threshold - rep
    if (remaining <= Math.max(50, Math.round(nextTier.threshold * 0.1))) {
      return {
        icon: "🌿",
        text: `You're only ${remaining} rep from ${nextTier.name} — one good contribution can get you there`,
        href: "/forum",
        cta: "Help a grower",
      }
    }
  }
  const openQuest = quests.find((q) => !q.done && !q.paid)
  if (openQuest) {
    return { icon: "⚡", text: `Today's quest: ${openQuest.title}`, href: "/forum", cta: "Do it" }
  }
  return {
    icon: "💬",
    text: "Answer a grower's question — accepted answers are the fastest way to grow your standing",
    href: "/forum",
    cta: "Browse threads",
  }
}
