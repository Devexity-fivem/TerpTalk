import Link from "next/link"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { href: string; label: string }
  className?: string
}

export default function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "bg-card/80 border border-border/70 rounded-2xl p-8 text-center",
        className
      )}
    >
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 ring-1 ring-primary/20 mb-4">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="font-display text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="tt-cta inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-full text-primary-foreground transition-all"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
