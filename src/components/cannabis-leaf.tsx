// TerpTalk brand mark — smooth stylized cannabis leaf
// 7 tapered leaflets fanning from a central point, with a stem
export default function CannabisLeaf({ className = "w-6 h-6" }: { className?: string }) {
  // [angle, scale] — outer leaflets are shorter
  const leaflets: [number, number][] = [
    [-75, 0.55], [-50, 0.7], [-25, 0.85], [0, 1], [25, 0.85], [50, 0.7], [75, 0.55],
  ]
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" className={className} aria-hidden="true">
      {leaflets.map(([angle, scale]) => (
        <g key={angle} transform={`translate(50 92) rotate(${angle}) scale(${scale}) translate(-50 -92)`}>
          <path d="M50 92 C 44 72, 43 50, 50 12 C 57 50, 56 72, 50 92 Z" />
        </g>
      ))}
      {/* stem */}
      <path d="M48 92 L52 92 L52 99 L48 99 Z" />
    </svg>
  )
}
