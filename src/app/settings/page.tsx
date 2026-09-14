import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { buildMetadata } from "@/lib/seo"
import {
  Settings, KeyRound, Download, Trash2, Ban, User, Bell, Shield, ChevronRight,
} from "lucide-react"

export const metadata = buildMetadata({
  title: "Settings",
  description: "TerpTalk account, privacy, and notification settings.",
  pathname: "/settings",
  robots: { index: false, follow: false },
})

type Item = { href: string; label: string; desc: string; icon: typeof KeyRound; danger?: boolean }

const SECTIONS: { title: string; icon: typeof KeyRound; items: Item[] }[] = [
  {
    title: "Account",
    icon: User,
    items: [
      { href: "/profile#recovery", label: "Recovery phrase", desc: "Generate or view the only way back into your account", icon: KeyRound },
      { href: "/profile#account", label: "Download my data", desc: "Export your account and content as JSON", icon: Download },
      { href: "/settings/blocked", label: "Blocked members", desc: "See who you've blocked and unblock them", icon: Ban },
      { href: "/profile", label: "Edit profile", desc: "Avatar, bio, badges, and public profile details", icon: User },
      { href: "/profile#account", label: "Delete my account", desc: "Permanently remove your account and content", icon: Trash2, danger: true },
    ],
  },
  {
    title: "Privacy",
    icon: Shield,
    items: [
      { href: "/settings/notifications#privacy", label: "Privacy controls", desc: "Online status, public recognition, and who can message you", icon: Shield },
    ],
  },
  {
    title: "Notifications",
    icon: Bell,
    items: [
      { href: "/settings/notifications", label: "Notification preferences", desc: "Replies, mentions, follows, messages, milestones, and TerpBot tips", icon: Bell },
    ],
  },
]

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/settings"))

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <div className="space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title} aria-labelledby={`settings-${section.title.toLowerCase()}`}>
              <h2 id={`settings-${section.title.toLowerCase()}`} className="text-lg font-semibold mb-3 flex items-center gap-2">
                <section.icon className="w-4 h-4 text-primary" aria-hidden="true" />
                {section.title}
              </h2>
              <div className="bg-card rounded-lg border border-border divide-y divide-border">
                {section.items.map((item) => (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    className="flex items-center gap-3 p-4 hover:bg-secondary/30 transition-colors group"
                  >
                    <item.icon
                      className={`w-4 h-4 shrink-0 ${item.danger ? "text-destructive" : "text-muted-foreground"}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 min-w-0">
                      <span className={`block font-medium ${item.danger ? "text-destructive" : ""}`}>{item.label}</span>
                      <span className="block text-sm text-muted-foreground">{item.desc}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
