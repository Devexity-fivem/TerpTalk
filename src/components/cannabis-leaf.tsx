// TerpTalk brand mark — stylized 7-leaflet cannabis leaf
export default function CannabisLeaf({ className = "w-6 h-6" }: { className?: string }) {
  const leaflets = [-66, -44, -22, 0, 22, 44, 66]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {leaflets.map((angle) => (
        <g key={angle} transform={`rotate(${angle} 12 20)`}>
          <path d="M12 20 C 10.6 14.5, 10.2 8, 12 1.5 C 13.8 8, 13.4 14.5, 12 20 Z" />
        </g>
      ))}
      <path d="M11.5 20 L12.5 20 L12.5 23.5 L11.5 23.5 Z" />
    </svg>
  )
}
