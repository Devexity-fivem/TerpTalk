import { ShieldCheck, Shield } from "lucide-react"

// Renders a staff badge next to usernames so users can verify legit staff.
// Returns null for regular members.
export default function RoleBadge({ role }: { role?: string | null }) {
  if (role === "ADMINISTRATOR") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded align-middle">
        <ShieldCheck className="w-3 h-3" />
        Admin
      </span>
    )
  }
  if (role === "MODERATOR") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-500 px-1.5 py-0.5 rounded align-middle">
        <Shield className="w-3 h-3" />
        Mod
      </span>
    )
  }
  return null
}
