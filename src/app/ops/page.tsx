import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { signInHref } from "@/lib/callback-url"
import { requireStaff } from "@/lib/require-staff"
import { buildMetadata } from "@/lib/seo"
import type { Metadata } from "next"

export const metadata: Metadata = buildMetadata({
  title: "Ops",
  description: "TerpTalk operational overview.",
  robots: { index: false, follow: false },
})

export const dynamic = "force-dynamic"

// /ops is consolidated into the Admin Command Center (/admin). The gate is
// kept here so the redirect preserves semantics exactly: guests go to
// sign-in, members get a 404 — no existence oracle.
export default async function OpsRedirect() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref("/ops"))
  const staff = await requireStaff()
  if (!staff) notFound()
  redirect("/admin")
}
