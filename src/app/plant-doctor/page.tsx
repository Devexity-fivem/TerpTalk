import ProblemWizard from "@/components/problem-wizard"
import { Stethoscope, MessageSquare, HelpCircle, Sprout } from "lucide-react"
import Link from "next/link"
import { getSymptomStats } from "@/lib/community-stats"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Plant Problem Solver",
  description: "Interactive diagnostic tool — answer a few questions about your plant's symptoms and get likely causes and fixes.",
}

export default async function PlantDoctorPage() {
  const stats = await getSymptomStats()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <Stethoscope className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">What&apos;s wrong with my plant?</h1>
          <p className="text-muted-foreground">
            Answer a few questions and we&apos;ll point you at the most likely cause — and how to fix it.
            Looking for site help instead? Visit the <Link href="/help" className="text-primary hover:underline">Help Center</Link>.
          </p>
        </div>
        <ProblemWizard />

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
        <div className="mt-8 bg-card/80 rounded-2xl border border-border/70 p-5">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold text-sm">Community outcomes</h2>
          </div>
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
        </div>
      </div>
    </div>
  )
}
