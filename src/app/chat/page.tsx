import { MessageCircle } from "lucide-react"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import ChatClient from "./chat-client"

import { buildMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = buildMetadata({
  title: "Community Chat",
  description: "Live conversation with the TerpTalk community — and TerpBot, our community assistant.",
  pathname: "/chat",
})

export default async function ChatPage() {
  const enabled = await getBooleanSetting(SITE_SETTINGS.CHAT_ENABLED, true)
  if (!enabled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <MessageCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h1 className="text-xl font-bold mb-2">Chat is temporarily disabled</h1>
          <p className="text-sm text-muted-foreground">The community chat is turned off right now. Check back later.</p>
        </div>
      </div>
    )
  }
  return <ChatClient />
}
