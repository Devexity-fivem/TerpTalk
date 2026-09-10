"use client"

import { cn } from "@/lib/utils"
import { User } from "lucide-react"

interface AvatarProps {
  src?: string | null
  alt?: string
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
  xl: "w-20 h-20 text-lg",
}

export function Avatar({ src, alt = "Avatar", size = "md", className }: AvatarProps) {
  return (
    <div
      className={cn(
        "relative rounded-full overflow-hidden bg-secondary flex items-center justify-center shrink-0",
        sizeMap[size],
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <User className="w-1/2 h-1/2 text-muted-foreground" />
      )}
    </div>
  )
}
