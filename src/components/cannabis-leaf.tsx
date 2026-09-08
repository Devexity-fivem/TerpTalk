// TerpTalk brand mark — serrated cannabis leaf (7 leaflets fanning from center)
// Leaflet paths are generated with sawtooth edges like a real cannabis leaf.

function serratedLeaf(len = 78, width = 15, teeth = 9): string {
  // width profile: peaks ~35% up the blade, tapers to base and tip
  const w = (t: number) => width * Math.sin(Math.PI * Math.pow(t, 0.75))
  const pts: string[] = []

  // Left edge — zigzag teeth going from base to tip
  pts.push(`M0 0`)
  for (let i = 0; i < teeth; i++) {
    const tV = i / teeth // valley (inner point)
    const tP = (i + 0.55) / teeth // peak (outer tooth point)
    pts.push(`L${(-w(tV) * 0.45).toFixed(1)} ${(-len * tV).toFixed(1)}`)
    pts.push(`L${(-w(tP)).toFixed(1)} ${(-len * tP).toFixed(1)}`)
  }
  // Tip
  pts.push(`L0 ${-len}`)

  // Right edge — zigzag teeth coming back down to base
  for (let i = teeth - 1; i >= 0; i--) {
    const tP = (i + 0.55) / teeth
    const tV = i / teeth
    pts.push(`L${w(tP).toFixed(1)} ${(-len * tP).toFixed(1)}`)
    pts.push(`L${(w(tV) * 0.45).toFixed(1)} ${(-len * tV).toFixed(1)}`)
  }
  pts.push("Z")
  return pts.join(" ")
}

// [angle, length, width] — center leaflet tallest, outer ones shorter
const LEAFLETS: [number, number, number][] = [
  [-78, 34, 7],
  [-52, 52, 11],
  [-26, 68, 13],
  [0, 80, 15],
  [26, 68, 13],
  [52, 52, 11],
  [78, 34, 7],
]

export function leafPath(angle: number, len: number, width: number) {
  return { d: serratedLeaf(len, width, 9), transform: `rotate(${angle} 50 92)` }
}

export default function CannabisLeaf({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" className={className} aria-hidden="true">
      {LEAFLETS.map(([a, l, w]) => (
        <path key={a} d={serratedLeaf(l, w)} transform={`translate(50 92) rotate(${a})`} />
      ))}
      {/* stem */}
      <path d="M48.5 92 L51.5 92 L51 99 L49 99 Z" />
    </svg>
  )
}
