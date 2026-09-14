import Link from "next/link"
import { buildMetadata } from "@/lib/seo"

export const metadata = buildMetadata({
  title: "Maintenance",
  description: "TerpTalk is temporarily down for maintenance.",
  robots: { index: false, follow: false },
})

export default function MaintenancePage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold mb-4">Maintenance</h1>
        <p className="text-muted-foreground mb-6">
          TerpTalk is temporarily down for maintenance. We&apos;ll be back soon.
        </p>
        <Link href="/admin" className="text-primary hover:underline text-sm">
          Staff login
        </Link>
      </div>
    </div>
  )
}
