"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Bell, Loader2, CheckCheck } from "lucide-react"
import Link from "next/link"

interface Notification {
  id: string
  type: string
  title: string
  content: string
  link: string | null
  read: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin")
    else if (status === "authenticated") {
      fetch("/api/notifications")
        .then((res) => res.ok ? res.json() : { notifications: [] })
        .then((d) => { setNotifications(d.notifications || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [status, router])

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  const unread = notifications.filter((n) => !n.read).length

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Bell className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">Notifications</h1>
            {unread > 0 && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{unread} new</span>
            )}
          </div>
          {unread > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <CheckCheck className="w-4 h-4" /> Mark all read
            </button>
          )}
        </div>

        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {notifications.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-50" />
              No notifications yet.
            </div>
          )}
          {notifications.map((n) => (
            <div key={n.id} className={`p-4 ${!n.read ? "bg-primary/5" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-sm break-words">{n.title}</h3>
                  <p className="text-sm text-muted-foreground break-words">{n.content}</p>
                  {n.link && (
                    <Link href={n.link} className="text-xs text-primary hover:underline">
                      View →
                    </Link>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(n.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
