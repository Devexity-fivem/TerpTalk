/* eslint-disable @next/next/no-img-element */
export function BadgeIcon({ icon, name }: { icon: string | null; name: string }) {
  if (!icon) return null
  if (icon.startsWith("http")) {
    return (
      <img
        src={icon}
        alt={name}
        width={20}
        height={20}
        className="inline-block w-5 h-5 object-contain"
        loading="lazy"
      />
    )
  }
  return <span>{icon}</span>
}
