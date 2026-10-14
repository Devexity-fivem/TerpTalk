import Link from "next/link"
import { Fragment } from "react"
import { hashtagPath, hashtagSlug } from "@/lib/moment-shared"

// Plain-text renderer for moments and moment comments: no markdown, just
// line breaks plus linked @mentions, #hashtags and http(s) URLs. React
// escapes every text node, so member text can never inject markup. The
// hashtag/mention grammar matches lib/moment-shared.ts + lib/mentions.ts.
const TOKEN_RE =
  /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,20})\b|(^|[^\p{L}\p{N}_&/#])#([A-Za-z][A-Za-z0-9_]{1,29})(?![A-Za-z0-9_])/gu

function renderLine(line: string, key: string) {
  const out: React.ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of line.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0
    if (m[1]) {
      if (start > last) out.push(line.slice(last, start))
      out.push(
        <a key={`${key}-${i++}`} href={m[1]} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary hover:underline break-all">
          {m[1]}
        </a>
      )
      last = start + m[0].length
    } else if (m[3]) {
      const lead = m[2] ?? ""
      if (start + lead.length > last) out.push(line.slice(last, start + lead.length))
      out.push(<Link key={`${key}-${i++}`} href={`/u/${m[3]}`} className="text-primary hover:underline">@{m[3]}</Link>)
      last = start + m[0].length
    } else if (m[5]) {
      const lead = m[4] ?? ""
      if (start + lead.length > last) out.push(line.slice(last, start + lead.length))
      out.push(
        <Link key={`${key}-${i++}`} href={hashtagPath(hashtagSlug(m[5]))} className="text-primary hover:underline">#{m[5]}</Link>
      )
      last = start + m[0].length
    }
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

export default function MomentText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n")
  return (
    <p className={className ?? "whitespace-pre-wrap wrap-break-word text-sm leading-relaxed"}>
      {lines.map((line, idx) => (
        <Fragment key={idx}>
          {renderLine(line, `l${idx}`)}
          {idx < lines.length - 1 && "\n"}
        </Fragment>
      ))}
    </p>
  )
}
