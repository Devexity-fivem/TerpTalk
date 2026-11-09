import ProblemWizard from "@/components/problem-wizard"
import PlantDoctorCases from "@/components/plant-doctor-cases"
import PageHeader from "@/components/ui/page-header"
import SectionCard from "@/components/ui/section-card"
import { Stethoscope, MessageSquare, HelpCircle, Sprout } from "@/lib/icons"
import Link from "next/link"
import { getSymptomStats } from "@/lib/community-stats"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { plantDoctorCasesFor } from "@/lib/plant-doctor"
import { buildMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"

export const metadata = buildMetadata({
  title: "Plant Problem Solver",
  description: "Interactive diagnostic tool — answer a few questions about your plant's symptoms and get likely causes and fixes.",
  pathname: "/plant-doctor",
})

export default async function PlantDoctorPage() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id ?? null

  const [stats, diaries, cases] = await Promise.all([
    getSymptomStats(),
    userId
      ? prisma.growDiary.findMany({
          where: { authorId: userId, deleted: false },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, title: true },
        })
      : Promise.resolve([] as { id: string; title: string }[]),
    userId ? plantDoctorCasesFor(userId) : Promise.resolve([]),
  ])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PageHeader
          size="md"
          context={<span className="tt-eyebrow">Plant care</span>}
          title={
            <span className="flex items-center gap-2">
              <Stethoscope className="w-6 h-6 text-primary" /> What&apos;s wrong with my plant?
            </span>
          }
          description={
            <>
              Answer a few questions and we&apos;ll point you at the most likely cause — and how to fix it.
              Looking for site help instead? Visit the <Link href="/help" className="text-primary hover:underline">Help Center</Link>.
            </>
          }
        />
        <ProblemWizard loggedIn={!!userId} diaries={diaries} />

        {/* Outcome loop — the member's private tracked cases. Reporting
            here is what turns a recommendation into reusable evidence. */}
        <PlantDoctorCases initialCases={cases} />

        {/* Grower context — a diagnosis is more useful attached to a
            documented grow, and the community can weigh in either way. */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link
            href="/questions"
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 text-sm font-medium hover:border-primary/40 transition-colors"
          >
            <HelpCircle className="w-4 h-4 text-primary" />
            Browse grow questions
          </Link>
          <Link
            href="/diaries/new"
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 text-sm font-medium hover:border-primary/40 transition-colors"
          >
            <Sprout className="w-4 h-4 text-primary" />
            Document your grow
          </Link>
        </div>

        {/* Community outcomes — aggregate-only stats from Plant Doctor threads */}
        <SectionCard spotlight compact className="mt-8"
          title={<span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />Community outcomes</span>}
        >
          {stats.threadCount === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not enough community data yet — outcomes appear once members post Plant Doctor threads.
            </p>
          ) : (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p>
                {stats.solvedCount} of {stats.threadCount} community threads have an accepted answer
                {stats.solvedPct != null ? ` (${stats.solvedPct}%)` : ""}.
              </p>
              {stats.medianHoursToAnswer != null && (
                <p>
                  median time to an accepted answer: ~{stats.medianHoursToAnswer}h ({stats.answerN} threads)
                </p>
              )}
              {stats.topTags.length > 0 && (
                <p>
                  common topics:{" "}
                  {stats.topTags
                    .slice(0, 4)
                    .map((t) => `${t.name} (${t.threads})`)
                    .join(" · ")}
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
