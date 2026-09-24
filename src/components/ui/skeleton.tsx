import { cn } from "@/lib/utils"

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("tt-shimmer rounded-md bg-secondary", className)} />
}
