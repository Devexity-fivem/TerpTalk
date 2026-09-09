"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { MapPin, Tag, Loader2, ArrowLeft, Mail, Trash2 } from "lucide-react"

interface Listing {
  id: string
  title: string
  description: string
  price: number | null
  condition: string | null
  location: string | null
  category: string
  status: string
  createdAt: string
  images: { url: string; sortOrder: number }[]
  seller: { id: string; name: string | null; role: string; profile: { username: string | null } | null }
  _count: { inquiries: number }
}

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const router = useRouter()
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setListing(d?.listing || null))
      .catch(() => setListing(null))
      .finally(() => setLoading(false))
  }, [id])

  const remove = async () => {
    if (!confirm("Remove this listing?")) return
    const res = await fetch(`/api/listings/${id}`, { method: "DELETE" })
    if (res.ok) router.push("/marketplace")
    else setError("Failed to remove")
  }

  const inquire = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError("")
    const res = await fetch(`/api/listings/${id}/inquire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
    setSending(false)
    if (res.ok) {
      setSent(true)
      setMessage("")
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error || "Failed to send inquiry")
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (!listing) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Listing not found</h1>
          <Link href="/marketplace" className="text-primary hover:underline"><ArrowLeft className="w-4 h-4 inline" /> Back to marketplace</Link>
        </div>
      </div>
    )
  }

  const isSeller = session?.user?.id === listing.seller.id
  const canRemove = isSeller || ["MODERATOR", "ADMINISTRATOR"].includes(session?.user?.role || "")

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/marketplace" className="text-sm text-primary hover:underline flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" /> Marketplace</Link>

        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Tag className="w-3 h-3" /> {listing.category}
                {listing.condition && <span>· {listing.condition}</span>}
                {listing.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{listing.location}</span>}
              </div>
              <h1 className="text-2xl font-bold">{listing.title}</h1>
            </div>
            <span className="text-lg font-semibold text-primary">{listing.price !== null ? `$${listing.price.toFixed(2)}` : "Trade/obo"}</span>
          </div>

          {listing.images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
              {listing.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.sortOrder} src={img.url} alt="" className="rounded-lg aspect-square object-cover border border-border" />
              ))}
            </div>
          )}

          <p className="whitespace-pre-wrap text-sm leading-relaxed mb-6">{listing.description}</p>

          <div className="text-sm text-muted-foreground mb-6">
            Listed by <Link href={`/u/${listing.seller.profile?.username || listing.seller.name || ""}`} className="text-primary hover:underline">{listing.seller.profile?.username || listing.seller.name}</Link> on {new Date(listing.createdAt).toLocaleDateString()}
          </div>

          {canRemove && (
            <button onClick={remove} className="mb-6 flex items-center gap-2 text-sm text-destructive hover:underline">
              <Trash2 className="w-4 h-4" /> Remove listing
            </button>
          )}

          {session && !isSeller && (
            <div className="border-t border-border pt-6">
              <h2 className="font-semibold mb-3 flex items-center gap-2"><Mail className="w-4 h-4" /> Contact seller</h2>
              {sent ? (
                <p className="text-sm text-green-600">Inquiry sent. The seller will be notified.</p>
              ) : (
                <form onSubmit={inquire} className="space-y-3">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    minLength={10}
                    maxLength={2000}
                    placeholder="Ask about condition, shipping, or local pickup..."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <button
                    type="submit"
                    disabled={sending || message.trim().length < 10}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send inquiry"}
                  </button>
                </form>
              )}
            </div>
          )}

          {!session && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4"><Link href="/auth/signin" className="text-primary hover:underline">Sign in</Link> to contact the seller.</p>
          )}
        </div>
      </div>
    </div>
  )
}
