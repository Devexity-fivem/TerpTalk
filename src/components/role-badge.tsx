import { ShieldCheck, Shield, CheckCircle } from "lucide-react"

// Renders a staff or verified badge next to usernames.
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
  if (role === "VERIFIED_MEMBER") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded align-middle">
        <CheckCircle className="w-3 h-3" />
        Verified
      </span>
    )
  }
  return null
}
