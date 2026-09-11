"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"

import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { Shield, Users, MessageSquare, AlertCircle, Loader2, Send } from "lucide-react"
import Link from "next/link"

const ROLES = [
  {
    id: "SUPPORT",
    title: "Support",
    icon: MessageSquare,
    summary: "First point of contact for the community.",
    responsibilities: [
      "Help users find answers and understand TerpTalk rules",
      "Triage questions and guide new members",
      "View moderation queues and reports but cannot take action",
      "Be patient, welcoming, and consistent",
    ],
    tasks: [
      "Answer questions in chat and forums",
      "Point users to guides, help docs, and relevant content",
      "Escalate rule violations to moderators",
      "Collect feedback and report common issues",
    ],
    powers: [
      "Can view reports and moderation context",
      "Can participate in staff chat",
      "Cannot warn, timeout, delete, or ban users",
    ],
  },
  {
    id: "MODERATOR",
    title: "Moderator",
    icon: Shield,
    summary: "Enforce rules and keep the community safe.",
    responsibilities: [
      "Enforce community guidelines fairly and consistently",
      "Review reports, flag content, and document decisions",
      "Set a positive tone and lead by example",
      "Communicate with support and admin on policy questions",
    ],
    tasks: [
      "Review reported threads, posts, comments, and chat messages",
      "Warn, delete content, and apply timeouts when appropriate",
      "Manage live-chat settings like slow mode and lock",
      "Help resolve disputes between members",
    ],
    powers: [
      "Can warn users and delete rule-breaking content",
      "Can apply temporary timeouts",
      "Can manage chat slowmode, lock, and clear",
      "Cannot permanently ban users or manage other staff",
    ],
  },
]

export default function StaffApplyPage() {
  const { data: session, status } = useSession()
  const { toast } = useToast()
  const [role, setRole] = useState<string>("SUPPORT")
  const [why, setWhy] = useState("")
  const [experience, setExperience] = useState("")
  const [about, setAbout] = useState("")
  const [sending, setSending] = useState(false)

  const userRole = (session?.user as { role?: string } | undefined)?.role
  const isStaff = ["SUPPORT", "MODERATOR", "ADMINISTRATOR"].includes(userRole ?? "")

  const selected = ROLES.find(r => r.id === role) ?? ROLES[0]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session) {
      toast("Sign in to apply", "error")
      return
    }
    setSending(true)
    try {
      const res = await fetch("/api/staff/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, why, experience, about }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast("Application submitted. We will review it soon.", "success")
        setWhy("")
        setExperience("")
        setAbout("")
      } else {
        toast(data.error || "Application failed", "error")
      }
    } catch (error) {
      console.error(error)
      toast("Application failed", "error")
    } finally {
      setSending(false)
    }
  }

  if (status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-4 py-12">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Sign in to apply</h1>
          <p className="text-muted-foreground mb-6">You need an account to apply for a staff role.</p>
          <Link href="/auth/signin" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  if (isStaff) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-4 py-12">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Shield className="w-10 h-10 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">You are already on staff</h1>
          <p className="text-muted-foreground mb-6">Contact an administrator if you want to discuss a role change.</p>
          <Link href="/" className="text-primary hover:underline">Back to home</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Apply for staff</h1>
      <p className="text-muted-foreground mb-8">
        Pick a role below, read the responsibilities, and tell us why you would be a good fit.
      </p>

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        {ROLES.map((r) => {
          const Icon = r.icon
          return (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              className={cn(
                "text-left rounded-2xl border p-5 transition-colors",
                role === r.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-secondary"
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                <Icon className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold">{r.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">{r.summary}</p>
              <h3 className="font-medium mb-1">Responsibilities</h3>
              <ul className="list-disc list-inside text-sm text-muted-foreground mb-4 space-y-0.5">
                {r.responsibilities.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <h3 className="font-medium mb-1">Typical tasks</h3>
              <ul className="list-disc list-inside text-sm text-muted-foreground mb-4 space-y-0.5">
                {r.tasks.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <h3 className="font-medium mb-1">What you can do</h3>
              <ul className="list-disc list-inside text-sm text-primary space-y-0.5">
                {r.powers.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-semibold">Application for {selected.title}</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="why" className="block text-sm font-medium mb-1">
              Why do you want this role?
            </label>
            <textarea
              id="why"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              required
              minLength={20}
              maxLength={2000}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Explain why this role matters to you and how you can help the community."
            />
          </div>
          <div>
            <label htmlFor="experience" className="block text-sm font-medium mb-1">
              Relevant experience
            </label>
            <textarea
              id="experience"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              required
              minLength={20}
              maxLength={2000}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Moderation, customer support, cannabis community leadership, or anything similar."
            />
          </div>
          <div>
            <label htmlFor="about" className="block text-sm font-medium mb-1">
              About you
            </label>
            <textarea
              id="about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              required
              minLength={20}
              maxLength={2000}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Tell us about your activity on TerpTalk, time zone, and how often you are available."
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Submit application
          </button>
        </form>
      </div>
    </main>
  )
}
