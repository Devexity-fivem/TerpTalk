import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { buildMetadata } from "@/lib/seo"
import { Sprout, ArrowRight, Check, X } from "@/lib/icons"

// ISR — the strain count refreshes hourly alongside its data cache.
export const revalidate = 3600

export const metadata = buildMetadata({
  title: "TerpTalk vs GrowDiaries & legacy grow forums",
  description:
    "How TerpTalk compares to GrowDiaries and the legacy cannabis forums — structured grow logs with deeper env metrics, a real community forum, a strain catalog, progression, and privacy by default.",
  pathname: "/compare",
})

// Live catalog size — the comparison table cites a real number, cached
// so the marketing page never hits the DB per request.
const getStrainCount = unstable_cache(
  async () => prisma.strain.count(),
  ["compare-strain-count"],
  { revalidate: 3600, tags: ["strains"] }
)

// Honest matrix — check means the platform has a real implementation,
// "Partial" means it exists but is thin. Keep claims verifiable: users who
// try us must find the checked row actually works. The strain-catalog row
// is filled with the live count at render time — never a hardcoded figure.
const ROWS: { feature: string; terptalk: string | true; gd: string | boolean | "Partial"; forums: string | boolean | "Partial" }[] = [
  { feature: "Structured week-by-week grow logs", terptalk: true, gd: true, forums: "Partial" },
  { feature: "Environment metrics (VPD, PPFD, CO2, runoff, trichomes)", terptalk: true, gd: "Partial", forums: false },
  { feature: "Real community forum with accepted answers", terptalk: true, gd: "Partial", forums: true },
  { feature: "Strain catalog with linked grow data", terptalk: "STRAIN_COUNT", gd: true, forums: false },
  { feature: "Progression, badges & grower levels", terptalk: true, gd: false, forums: false },
  { feature: "Plant Doctor & deterministic grow assistant", terptalk: true, gd: false, forums: false },
  { feature: "Draft auto-save in the log editor", terptalk: true, gd: true, forums: false },
  { feature: "Live chat + DMs", terptalk: true, gd: true, forums: "Partial" },
  { feature: "Contests & weekly recognition", terptalk: true, gd: true, forums: "Partial" },
  { feature: "Pseudonymous privacy controls", terptalk: true, gd: "Partial", forums: "Partial" },
  { feature: "Modern fast UI", terptalk: true, gd: true, forums: false },
  { feature: "Moderation + anti-abuse tooling", terptalk: true, gd: "Partial", forums: "Partial" },
]

function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return <Check className="w-4 h-4 text-success inline" aria-label="Yes" />
  if (v === false || v === undefined)
    return <X className="w-4 h-4 text-muted-foreground/50 inline" aria-label="No" />
  if (v === "Partial")
    return <span className="text-xs font-medium text-warning">Partial</span>
  return <span className="text-xs font-semibold text-primary">{v}</span>
}

export default async function ComparePage() {
  const strainCount = await getStrainCount()
  const rows = ROWS.map((r) =>
    r.terptalk === "STRAIN_COUNT"
      ? { ...r, terptalk: `${strainCount.toLocaleString("en-US")} strains` }
      : r
  )
  return (
    <div className="min-h-screen bg-background">
      <div className="relative overflow-hidden px-4 pt-14 pb-10 sm:px-6 lg:px-8">
        <div className="tt-grid-bg absolute inset-0" />
        <div className="relative mx-auto max-w-3xl text-center">
          <div className="tt-eyebrow mb-3">The honest comparison</div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Why growers are{" "}
            <span className="tt-gradient-text bg-linear-to-r from-primary via-success to-spectrum">
              moving to TerpTalk
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
            GrowDiaries made the grow log. The legacy forums made the community.
            TerpTalk is both — plus the metrics, assistant, and progression
            layer neither of them built.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 pb-16">
        <div className="tt-spotlight tt-edge-card overflow-hidden rounded-2xl border border-border/70 bg-card/80">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="px-4 py-3 font-semibold">Feature</th>
                <th className="px-3 py-3 text-center font-semibold text-primary">TerpTalk</th>
                <th className="px-3 py-3 text-center font-semibold">GrowDiaries</th>
                <th className="px-3 py-3 text-center font-semibold">Legacy forums</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feature} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">{r.feature}</td>
                  <td className="px-3 py-2.5 text-center"><Cell v={r.terptalk} /></td>
                  <td className="px-3 py-2.5 text-center"><Cell v={r.gd} /></td>
                  <td className="px-3 py-2.5 text-center"><Cell v={r.forums} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground text-center">
          &ldquo;Partial&rdquo; = the feature exists but is thin or paywalled.
          Verify it yourself — every checked row is live on the platform.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "Deeper grow data",
              d: "VPD, PPFD, CO₂, runoff pH/EC, lamp distance, trichome state, aroma — most platforms track a fraction of what we log per week.",
            },
            {
              t: "A real community",
              d: "Not a comments section — a moderated forum with accepted answers, reputation, and growers who actually help.",
            },
            {
              t: "Private by design",
              d: "Pseudonymous by default. Your grows, your call — public, unlisted, or fully private diaries.",
            },
          ].map((c) => (
            <div key={c.t} className="tt-spotlight rounded-2xl border border-border/70 bg-card/80 p-5">
              <h3 className="font-display font-semibold mb-1.5">{c.t}</h3>
              <p className="text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/diaries"
            className="tt-cta inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-primary-foreground"
          >
            <Sprout className="w-4 h-4" /> Browse real grow diaries <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
