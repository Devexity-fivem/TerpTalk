import { ShieldCheck, Shield, CheckCircle, LifeBuoy } from "lucide-react"
import Tooltip from "@/components/ui/tooltip"

// Renders a staff or verified badge next to usernames.
export default function RoleBadge({ role }: { role?: string | null }) {
  if (role === "SUPPORT") {
    return (
      <Tooltip content="Support staff">
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-teal-500/15 text-teal-500 px-1.5 py-0.5 rounded align-middle">
          <LifeBuoy className="w-3 h-3" />
          Support
        </span>
      </Tooltip>
    )
  }
  if (role === "ADMINISTRATOR") {
    return (
      <Tooltip content="Site administrator">
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-500 px-1.5 py-0.5 rounded align-middle">
          <ShieldCheck className="w-3 h-3" />
          Admin
        </span>
      </Tooltip>
    )
  }
  if (role === "MODERATOR") {
    return (
      <Tooltip content="Community moderator">
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-500 px-1.5 py-0.5 rounded align-middle">
          <Shield className="w-3 h-3" />
          Mod
        </span>
      </Tooltip>
    )
  }
  if (role === "VERIFIED_MEMBER") {
    return (
      <Tooltip content="Verified member — established, trusted grower">
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded align-middle">
          <CheckCircle className="w-3 h-3" />
          Verified
        </span>
      </Tooltip>
    )
  }
  return null
}
