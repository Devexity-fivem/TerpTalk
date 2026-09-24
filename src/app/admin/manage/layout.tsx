import { notFound } from "next/navigation"
import { requireAdmin } from "@/lib/require-staff"

// Server-side gate for the management surface (users/announce/security/
// reputation/affiliates/feedback/terpbot tabs). The page also checks the
// role client-side and every API inside is requireAdmin — this layout
// keeps the page itself from rendering for non-administrators at all.
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()
  if (!admin) notFound()
  return children
}
