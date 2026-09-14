import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import Link from "next/link"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { buildMetadata } from "@/lib/seo"
import { Ban, ArrowLeft } from "lucide-react"
import BlockedMembers from "@/components/blocked-members"

export const metadata = buildMetadata({
  title: "Blocked Members",
  description: "Manage the members you've blocked on TerpTalk.",
  pathname: "/settings/blocked",
  robots: { index: false, follow: false },
})

export default async function BlockedSettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/settings/blocked"))

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Settings
        </Link>
        <div className="mb-6 flex items-center gap-2">
          <Ban className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Blocked members</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Blocked members can&apos;t send you direct messages or follow you. Blocking is private — they aren&apos;t notified.
        </p>
        <BlockedMembers />
      </div>
    </div>
  )
}
