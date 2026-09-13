"use client"

import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/components/ui/toast"
import MilestoneCelebration from "@/components/milestone-celebration"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        {children}
        <MilestoneCelebration />
      </ToastProvider>
    </SessionProvider>
  )
}
