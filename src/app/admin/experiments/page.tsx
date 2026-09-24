import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/require-staff"
import AdminExperiments from "@/components/admin-experiments"

export const dynamic = "force-dynamic"

// Product change log + small experiment records. Admin-only: the log is
// operational context, not community content.
export default async function AdminExperimentsPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()
  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold font-display">Changes &amp; Experiments</h1>
        <p className="text-sm text-muted-foreground">
          Record what changed and why — so behavior shifts in Growth/Retention can be correlated with real changes later.
          Not an A/B platform: a written record with a hypothesis and an honest result.
        </p>
      </div>
      <AdminExperiments />
    </main>
  )
}
