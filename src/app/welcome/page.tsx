import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { safeCallbackUrl, signInHref } from "@/lib/callback-url"
import OnboardingStepper from "@/components/onboarding-stepper"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Welcome to TerpTalk",
  description: "Set up your TerpTalk experience.",
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl } = await searchParams
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    redirect(signInHref("/welcome"))
  }

  const callback = safeCallbackUrl(callbackUrl)

  // Existing users who already finished onboarding never see this page.
  if (session.user.onboardingCompletedAt) {
    redirect(callback ?? "/")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      recoveryPhraseHash: true,
      profile: {
        select: { username: true, avatarUrl: true, bio: true, location: true },
      },
      // `followers` is the inverted relation name — these are rows where the
      // viewer is the follower.
      _count: { select: { followers: true } },
      categoryFollows: { select: { categoryId: true } },
    },
  })
  if (!user) redirect(signInHref("/welcome"))

  const categories = await prisma.category.findMany({
    where: { hidden: false },
    orderBy: { order: "asc" },
    select: { id: true, name: true, slug: true, description: true },
  })

  return (
    <OnboardingStepper
      callbackUrl={callback}
      initial={{
        username: user.profile?.username ?? session.user.username ?? "",
        avatarUrl: user.profile?.avatarUrl ?? null,
        bio: user.profile?.bio ?? "",
        location: user.profile?.location ?? "",
        hasPhrase: !!user.recoveryPhraseHash,
        followedCategoryIds: user.categoryFollows.map((c) => c.categoryId),
        followedUserCount: user._count.followers,
      }}
      categories={categories}
    />
  )
}
