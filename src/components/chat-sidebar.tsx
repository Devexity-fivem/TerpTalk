"use client"

import { useState, useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { MessageCircle, Send, X, Loader2 } from "lucide-react"

interface Room {
  id: string
  name: string
  slug: string
  description: string
  _count: { messages: number }
}

interface Message {
  id: string
  content: string
  createdAt: string
  author: {
    name: string
    profile: { username: string }
  }
}

export default function ChatSidebar() {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState("general")
  const [message, setMessage] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }

  // Load rooms
  useEffect(() => {
    if (!session) return

    fetch("/api/chat/rooms")
      .then(res => res.json())
      .then(data => {
        setRooms(data.rooms || [])
        if (data.rooms?.length > 0) {
          setSelectedRoom(data.rooms[0].slug)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [session])

  // Load messages when room changes
  useEffect(() => {
    if (!session || !selectedRoom) return

    const room = rooms.find(r => r.slug === selectedRoom)
    if (!room) return

    fetch(`/api/chat/messages?roomId=${room.id}`)
      .then(res => res.json())
      .then(data => {
        setMessages(data.messages || [])
        scrollToBottom()
      })
      .catch(() => setMessages([]))

    // Poll for new messages every 3 seconds
    const interval = setInterval(() => {
      fetch(`/api/chat/messages?roomId=${room.id}`)
        .then(res => res.json())
        .then(data => {
          setMessages(data.messages || [])
        })
        .catch(() => {})
    }, 3000)

    return () => clearInterval(interval)
  }, [session, selectedRoom, rooms])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || !session || sending) return

    const room = rooms.find(r => r.slug === selectedRoom)
    if (!room) return

    setSending(true)
    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, roomId: room.id }),
      })

      if (response.ok) {
        const data = await response.json()
        setMessages(prev => [...prev, data.message])
        setMessage("")
        scrollToBottom()
      }
    } catch (error) {
      console.error("Failed to send message:", error)
    } finally {
      setSending(false)
    }
  }

  if (!session) {
    return null
  }

  const currentRoom = rooms.find(r => r.slug === selectedRoom)

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-4 right-4 z-50 bg-primary text-primary-foreground p-3 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Toggle chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>

      {/* Floating chat panel */}
      <aside
        className={`
          fixed bottom-20 right-4 z-50
          w-[calc(100vw-2rem)] sm:w-96
          h-[70vh] max-h-[600px]
          bg-card border border-border rounded-xl shadow-2xl
          flex flex-col overflow-hidden
          transition-all duration-200
          ${isOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"}
        `}
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Live Chat</h2>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
              {rooms.length} rooms
            </span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-secondary rounded"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Room List */}
        <div className="overflow-y-auto border-b border-border max-h-36 shrink-0">
          <div className="p-2">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No chat rooms available
              </div>
            ) : (
              rooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoom(room.slug)}
                  className={`
                    w-full text-left px-3 py-2 rounded-lg mb-0.5 transition-colors
                    ${selectedRoom === room.slug
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary"
                    }
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{room.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {room._count.messages}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border shrink-0">
            <h3 className="font-medium text-sm">{currentRoom?.name || "Chat"}</h3>
            <p className="text-xs text-muted-foreground">{currentRoom?.description}</p>
          </div>

          <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-3 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No messages yet. Start the conversation!
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-xs">
                      {msg.author.profile?.username || msg.author.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-sm bg-secondary/50 rounded-lg px-3 py-2">
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <form onSubmit={handleSendMessage} className="p-3 border-t border-border shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !message.trim()}
                className="bg-primary text-primary-foreground p-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  )
}
