"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { Shield, CheckCircle, XCircle, Loader2, User, Clock, FileText } from "lucide-react"
import Link from "next/link"

type Application = {
  id: string
  role: string
  why: string
  experience: string
  about: string
  status: string
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  applicant: {
    id: string
    name: string | null
    username: string | null
    image: string | null
    role: string | null
  }
}

export default function StaffApplicationsAdminPage() {
  const { data: session, status } = useSession()
  const { toast } = useToast()
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Application | null>(null)
  const [reviewNote, setReviewNote] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING")

  const userRole = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = userRole === "ADMINISTRATOR"

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return
    let mounted = true
    const fetchApplications = async () => {
      try {
        const res = await fetch(`/api/staff/applications?status=${filter}`)
        const data = await res.json().catch(() => ({}))
        if (!mounted) return
        if (res.ok) {
          setApplications(data.applications ?? [])
        } else {
          toast(data.error || "Failed to load applications", "error")
        }
      } catch (error) {
        console.error(error)
        if (mounted) toast("Failed to load applications", "error")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    fetchApplications()
    return () => {
      mounted = false
    }
  }, [status, isAdmin, filter, toast])

  const review = async (id: string, status: "APPROVED" | "REJECTED") => {
    setBusy(id)
    try {
      const res = await fetch(`/api/staff/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNote }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast(`Application ${status.toLowerCase()}`, "success")
        setApplications(prev => prev.filter(a => a.id !== id))
        setActive(null)
        setReviewNote("")
      } else {
        toast(data.error || "Review failed", "error")
      }
    } catch (error) {
      console.error(error)
      toast("Review failed", "error")
    } finally {
      setBusy(null)
    }
  }

  if (status === "loading" || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen max-w-3xl mx-auto px-4 py-12 text-center">
        <Shield className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Admins only</h1>
        <p className="text-muted-foreground mb-6">You do not have permission to review staff applications.</p>
        <Link href="/" className="text-primary hover:underline">Back to home</Link>
      </main>
    )
  }

  return (
    <main className="min-h-screen max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-7 h-7 text-primary" />
        <h1 className="text-2xl font-bold">Staff Applications</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            )}
          >
            {f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {applications.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
          No {filter.toLowerCase()} applications.
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div
              key={app.id}
              className="rounded-2xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">
                    {app.applicant.username?.[0]?.toUpperCase() ?? app.applicant.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div>
                    <p className="font-semibold">
                      {app.applicant.username || app.applicant.name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(app.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  {app.role}
                </span>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div>
                  <span className="font-medium">Why they want the role</span>
                  <p className="text-muted-foreground whitespace-pre-line mt-1">{app.why}</p>
                </div>
                <div>
                  <span className="font-medium">Experience</span>
                  <p className="text-muted-foreground whitespace-pre-line mt-1">{app.experience}</p>
                </div>
                <div>
                  <span className="font-medium">About them</span>
                  <p className="text-muted-foreground whitespace-pre-line mt-1">{app.about}</p>
                </div>
              </div>

              {filter === "PENDING" && (
                <div className="mt-5 flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setActive(app)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm hover:bg-secondary/80"
                  >
                    <FileText className="w-4 h-4" />
                    Review
                  </button>
                  <Link
                    href={`/u/${app.applicant.username ?? app.applicant.name ?? app.applicant.id}`}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm hover:bg-secondary/80"
                  >
                    <User className="w-4 h-4" />
                    View profile
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-background p-6">
            <h2 className="text-xl font-bold mb-2">Review application</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {active.applicant.username || active.applicant.name} applied for {active.role}.
            </p>
            <label htmlFor="note" className="block text-sm font-medium mb-1">
              Review note (optional)
            </label>
            <textarea
              id="note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              maxLength={1000}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring mb-4"
              placeholder="Reason for approval or rejection. Only admins can see this."
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setActive(null)
                  setReviewNote("")
                }}
                className="px-4 py-2 rounded-lg bg-secondary text-sm hover:bg-secondary/80"
              >
                Cancel
              </button>
              <button
                onClick={() => review(active.id, "REJECTED")}
                disabled={busy === active.id}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm hover:bg-destructive/90 disabled:opacity-50"
              >
                {busy === active.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Reject
              </button>
              <button
                onClick={() => review(active.id, "APPROVED")}
                disabled={busy === active.id}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === active.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
