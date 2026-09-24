import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { requireStaff } from "@/lib/require-staff"
import { isAdmin } from "@/lib/security"
import { buildMetadata } from "@/lib/seo"
import {
  LayoutDashboard, Users, Sprout, ShieldAlert, TrendingUp,
  MessageSquarePlus, Bot, Activity, Wrench, ShieldCheck, Flag, Repeat2, FlaskConical,
} from "lucide-react"

export const metadata: Metadata = buildMetadata({
  title: "Admin",
  description: "TerpTalk administration.",
  robots: { index: false, follow: false },
})

// Admin command-center shell. The layout is the outer gate: guests are sent
// to sign-in and non-staff get a 404 so members can't discover the surface
// exists. Every page and API inside still enforces its own role level —
// this nav is UX, not authorization.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/admin"))
  const staff = await requireStaff()
  if (!staff) notFound()
  const admin = isAdmin(staff.role)

  const nav: { href: string; label: string; icon: typeof Flag; adminOnly?: boolean }[] = [
    { href: "/admin", label: "Overview", icon: LayoutDashboard },
    { href: "/admin/community", label: "Community", icon: Sprout },
    { href: "/admin/members", label: "Members", icon: Users },
    { href: "/moderation", label: "Moderation", icon: Flag },
    { href: "/admin/growth", label: "Growth", icon: TrendingUp, adminOnly: true },
    { href: "/admin/retention", label: "Retention", icon: Repeat2, adminOnly: true },
    { href: "/admin/experiments", label: "Changes", icon: FlaskConical, adminOnly: true },
    { href: "/admin/manage?tab=feedback", label: "Feedback", icon: MessageSquarePlus, adminOnly: true },
    { href: "/admin/manage?tab=terpbot", label: "TerpBot", icon: Bot, adminOnly: true },
    { href: "/admin/system", label: "System", icon: Activity, adminOnly: true },
    { href: "/admin/manage?tab=security", label: "Security", icon: ShieldAlert, adminOnly: true },
    { href: "/admin/manage", label: "Manage", icon: Wrench, adminOnly: true },
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/60 bg-card/50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center gap-2 py-3">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-semibold">Command Center</span>
            <span className="text-[11px] text-muted-foreground">
              {admin ? "administrator" : staff.role.toLowerCase()}
            </span>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1" aria-label="Admin sections">
            {nav.filter((n) => !n.adminOnly || admin).map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary whitespace-nowrap transition-colors"
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  )
}
