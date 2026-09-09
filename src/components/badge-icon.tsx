import Image from "next/image"

export function BadgeIcon({ icon, name }: { icon: string | null; name: string }) {
  if (!icon) return null
  if (icon.startsWith("http")) {
    return (
      <Image
        src={icon}
        alt={name}
        width={20}
        height={20}
        unoptimized
        className="inline-block w-5 h-5"
      />
    )
  }
  return <span>{icon}</span>
}
