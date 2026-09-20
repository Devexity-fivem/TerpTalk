/**
 * Guided Journeys — derived onboarding-to-participation path.
 *
 * No persistence model: each step is a predicate over existing rows, and
 * journey completion is a single keyed reputation award
 * (`journey:<slug>:<userId>`). "Getting Rooted" walks a new member from
 * signup to real community participation — the behaviours TerpTalk exists
 * to encourage, not busywork.
 */
import { prisma } from "@/lib/prisma"
import { awardReputation } from "@/lib/reputation"
import { TRUSTED_LINKS_REP } from "@/lib/reputation-config"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"

export interface JourneyStep {
  key: string
  title: string
  description: string
  icon: string
  done: boolean
  /** Where the member goes to do it. */
  href: string
  cta: string
}

export interface JourneyState {
  slug: string
  name: string
  description: string
  steps: JourneyStep[]
  doneCount: number
  complete: boolean
  /** Small one-time bundle paid through the ledger on completion. */
  reward: number
  /** True once the keyed award row exists — survives later regressions. */
  paid: boolean
}

const SPROUT_THRESHOLD = TRUSTED_LINKS_REP
const JOURNEY_REWARD = 25
const JOURNEY_SLUG = "getting-rooted"

interface JourneyInputs {
  onboardingDone: boolean
  reputation: number
  threads: number
  posts: number
  likesGiven: number
  diaries: number
  diaryUpdates: number
  journeyPaid: boolean
}

function buildSteps(i: JourneyInputs): JourneyStep[] {
  return [
    {
      key: "onboarded",
      title: "Set up your profile",
      description: "Finish onboarding — pick a username and tell growers who you are.",
      icon: "🏡",
      done: i.onboardingDone,
      href: "/welcome",
      cta: "Finish setup",
    },
    {
      key: "first-post",
      title: "Join a discussion",
      description: "Start a thread or reply to a grower's question.",
      icon: "💬",
      done: i.threads + i.posts > 0,
      href: "/forum",
      cta: "Browse the forum",
    },
    {
      key: "first-like",
      title: "Show some love",
      description: "Like a post or update that helped you — it pays the author reputation.",
      icon: "💚",
      done: i.likesGiven > 0,
      href: "/feed",
      cta: "See the feed",
    },
    {
      key: "first-diary",
      title: "Start a grow diary",
      description: "Document a real grow — it's what TerpTalk is for.",
      icon: "🌱",
      done: i.diaries > 0,
      href: "/diaries/new",
      cta: "Start a diary",
    },
    {
      key: "first-update",
      title: "Log your first update",
      description: "Add a photo or a note to your diary — each day counts.",
      icon: "📓",
      done: i.diaryUpdates > 0,
      href: "/diaries",
      cta: "Open your diary",
    },
    {
      key: "sprout",
      title: "Reach Sprout",
      description: `Earn ${SPROUT_THRESHOLD} reputation through real participation.`,
      icon: "🌿",
      done: i.reputation >= SPROUT_THRESHOLD,
      href: "/progress",
      cta: "Track progress",
    },
  ]
}

/** Derived journey state — safe for the member's own progression page. */
export async function getJourneyState(userId: string): Promise<JourneyState | null> {
  if (!(await getBooleanSetting(SITE_SETTINGS.JOURNEYS_ENABLED, true))) return null

  const [user, likesGiven, diaryUpdates, journeyPaid] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        onboardingCompletedAt: true,
        profile: { select: { reputation: true } },
        _count: { select: { threadCreator: true, posts: true, diaryCreator: true } },
      },
    }),
    // Positive reactions only — a downvote shouldn't tick "show some love".
    prisma.reaction.count({ where: { userId, type: { in: ["LIKE", "LOVE", "FIRE", "THUMBS_UP"] } } }),
    prisma.diaryUpdate.count({ where: { authorId: userId } }),
    prisma.reputationEvent.findUnique({
      where: { key: `journey:${JOURNEY_SLUG}:${userId}` },
      select: { id: true },
    }),
  ])
  if (!user?.profile) return null

  const steps = buildSteps({
    onboardingDone: !!user.onboardingCompletedAt,
    reputation: user.profile.reputation,
    threads: user._count.threadCreator,
    posts: user._count.posts,
    likesGiven,
    diaries: user._count.diaryCreator,
    diaryUpdates,
    journeyPaid: !!journeyPaid,
  })
  const doneCount = steps.filter((s) => s.done).length
  return {
    slug: JOURNEY_SLUG,
    name: "Getting Rooted",
    description: "Six steps from new member to rooted grower.",
    steps,
    doneCount,
    complete: doneCount === steps.length,
    reward: JOURNEY_REWARD,
    paid: !!journeyPaid,
  }
}

/**
 * Pay the one-time completion bundle if every step is done. Keyed so it is
 * idempotent and clawback-compatible; called from the progression endpoint
 * (the same place quests/challenges evaluate).
 */
export async function evaluateJourneys(userId: string, state?: JourneyState | null): Promise<void> {
  const s = state ?? (await getJourneyState(userId))
  if (!s || !s.complete) return
  await awardReputation(
    userId,
    "JOURNEY_COMPLETE",
    JOURNEY_REWARD,
    "Completed the Getting Rooted journey",
    { key: `journey:${JOURNEY_SLUG}:${userId}`, sourceType: "JOURNEY", sourceId: JOURNEY_SLUG }
  ).catch(() => {})
}
