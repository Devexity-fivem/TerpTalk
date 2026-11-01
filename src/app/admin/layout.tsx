import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { getSession } from "@/lib/session"
import { Suspense } from "react"
import AdminNav from "@/components/admin-nav"
import { signInHref } from "@/lib/callback-url"
import { requireStaff } from "@/lib/require-staff"
import { isAdmin } from "@/lib/security"
import { buildMetadata } from "@/lib/seo"
import {
  LayoutDashboard, Users, Sprout, ShieldAlert, TrendingUp,
  MessageSquarePlus, Bot, Activity, Wrench, ShieldCheck, Flag, Repeat2, FlaskConical,
} from "@/lib/icons"

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
  const session = await getSession()
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
      <div className="tt-glass tt-hairline-b border-b border-border/60">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center gap-2 py-3">
            <div className="tt-brand-tile rounded-lg p-1">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            </div>
            <span className="tt-eyebrow">Command Center</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {admin ? "administrator" : staff.role.toLowerCase()}
            </span>
          </div>
          <Suspense fallback={
            <nav className="flex gap-1 overflow-x-auto pb-2 -mx-1 px-1" aria-hidden>
              {nav.filter((n) => !n.adminOnly || admin).map((n) => (
                <span key={n.href} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-muted-foreground whitespace-nowrap">{n.label}</span>
              ))}
            </nav>
          }>
            <AdminNav items={nav.filter((n) => !n.adminOnly || admin)} />
          </Suspense>
        </div>
      </div>
      {children}
    </div>
  )
}
