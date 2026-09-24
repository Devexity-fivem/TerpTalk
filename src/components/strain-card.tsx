import Link from "next/link"
import { Leaf, Dna, Clock, Gauge } from "lucide-react"
import { strainTypeLabel } from "@/lib/strain-stats"
import {
  STRAIN_EFFECT_LABELS,
  STRAIN_DIFFICULTY_LABELS,
  type StrainDifficulty,
} from "@/lib/strain-fields"
import { strainPath } from "@/lib/slugs"

/** Minimum strain shape the card needs — satisfied by the index,
 *  breeder, and any future listing query. */
export interface StrainCardData {
  id: string
  slug: string | null
  name: string
  genetics: string | null
  breeder: string | null
  type: string | null
  effects: string[]
  difficulty: string | null
  floweringWeeks: number | null
  thcMin: number | null
  thcMax: number | null
  photos: { imageUrl: string }[]
  _count: { photos: number; diaries: number }
}

/** Shared strain catalog card — only renders real reported metadata;
 *  a facet that was never reported simply doesn't appear. */
export default function StrainCard({ strain }: { strain: StrainCardData }) {
  return (
    <Link
      href={strainPath(strain)}
      className="tt-spotlight group bg-card rounded-2xl border border-border/70 overflow-hidden tt-lift hover:border-primary/50"
    >
      <div className="relative aspect-[16/9] bg-gradient-to-br from-primary/15 via-secondary to-spectrum/10 flex items-center justify-center overflow-hidden">
        {strain.photos[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={strain.photos[0].imageUrl} alt={strain.name} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <Leaf className="w-8 h-8 text-primary/30" />
        )}
        {strain.type && (
          <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {strainTypeLabel(strain.type)}
          </span>
        )}
        {strain._count.photos > 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            {strain._count.photos} photo{strain._count.photos !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-display font-semibold line-clamp-1 group-hover:text-primary transition-colors">{strain.name}</h3>
        {strain.breeder && (
          <p className="text-xs text-muted-foreground mt-0.5">by {strain.breeder}</p>
        )}
        {(strain.difficulty || strain.floweringWeeks != null) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {strain.difficulty && (
              <span className="inline-flex items-center gap-1">
                <Gauge className="w-3 h-3" />{STRAIN_DIFFICULTY_LABELS[strain.difficulty as StrainDifficulty] ?? strain.difficulty}
              </span>
            )}
            {strain.floweringWeeks != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />~{strain.floweringWeeks} wk flower
              </span>
            )}
          </div>
        )}
        {strain.effects.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {strain.effects.slice(0, 3).map((e) => (
              <span key={e} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {STRAIN_EFFECT_LABELS[e as keyof typeof STRAIN_EFFECT_LABELS] ?? e}
              </span>
            ))}
            {strain.effects.length > 3 && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                +{strain.effects.length - 3}
              </span>
            )}
          </div>
        )}
        {strain.genetics && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-1.5 border-t border-border/50 pt-1.5 flex items-center gap-1">
            <Dna className="w-3 h-3 shrink-0 text-spectrum" />
            <span className="truncate">{strain.genetics}</span>
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground border-t border-border/50 pt-2">
          {strain._count.diaries > 0 && (
            <span className="inline-flex items-center gap-1">
              <Leaf className="w-3 h-3" />
              {strain._count.diaries} grow{strain._count.diaries === 1 ? "" : "s"}
            </span>
          )}
          {(strain.thcMin != null || strain.thcMax != null) && (
            <span className="ml-auto">
              {strain.thcMin != null && strain.thcMax != null
                ? `${strain.thcMin}–${strain.thcMax}% THC`
                : `~${strain.thcMin ?? strain.thcMax}% THC`}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
