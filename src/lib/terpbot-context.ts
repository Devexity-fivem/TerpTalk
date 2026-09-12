// Thread-context extraction — pure module, no Prisma, no next.
//
// Finds `/forum/thread/<slug>` references in chat text so TerpBot's
// context-aware commands (summarize / answered / about) can resolve which
// thread a member is talking about. Slugs are generated lowercase with
// hyphens; the charset check keeps arbitrary text from being treated as a
// reference, and the loader applies the real visibility gates.

export interface ThreadRef {
  slug: string
  postId?: string
}

const THREAD_LINK_RE = /\/forum\/thread\/([a-zA-Z0-9-]{2,200})\b/
const POST_PARAM_RE = /[?&]post=([a-z0-9]{25})\b/

// First thread link in the text, or null. Optionally captures a `?post=`
// deep-link target pointing at a specific reply inside that thread.
export function extractThreadRef(text: string): ThreadRef | null {
  const m = text.match(THREAD_LINK_RE)
  if (!m || m.index === undefined) return null
  const post = text.slice(m.index).match(POST_PARAM_RE)
  return { slug: m[1], postId: post?.[1] }
}
