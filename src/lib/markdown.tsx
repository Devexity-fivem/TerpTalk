import React from "react"
import Link from "next/link"

const ALLOWED_LINK_PREFIX = /^(https?:|mailto:)/i
const MENTION_RE = /\B@([a-zA-Z0-9_]{3,20})/g
const URL_RE = /(\bhttps?:\/\/[a-zA-Z0-9][-a-zA-Z0-9@:%._\/+~#=?!&]*[-a-zA-Z0-9@%_\/+~#=?!&])/g

type MarkdownToken =
  | { type: "text"; text: string }
  | { type: "bold"; children: MarkdownToken[] }
  | { type: "italic"; children: MarkdownToken[] }
  | { type: "strike"; children: MarkdownToken[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string | null }
  | { type: "mention"; username: string }
  | { type: "url"; href: string }

function escapeForClass(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function sanitizeHref(href: string): string | null {
  if (href.startsWith("/") && !href.startsWith("//")) return href
  if (ALLOWED_LINK_PREFIX.test(href)) return href
  return null
}

// Parse inline text into an array of tokens. Supported: **bold**, *italic*,
// __bold__, _italic_, `code`, ~~strikethrough~~, [text](url), @mentions, and
// plain URLs. Nested bold/italic is allowed; code spans are literal.
function tokenizeInline(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  const patterns: [RegExp, (m: RegExpExecArray) => MarkdownToken | MarkdownToken[]][] = [
    [/^```[\s\S]*?```|^`[^`\n]*`/, (m) => ({ type: "code", text: m[0].startsWith("```") ? m[0].slice(3, -3) : m[0].slice(1, -1) })],
    [/^(?:\*\*|__)([\s\S]+?)(?:\*\*|__)/, (m) => ({ type: "bold", children: tokenizeInline(m[1]) })],
    [/^(?:\*|_)([^*_\n]+?)(?:\*|_)/, (m) => ({ type: "italic", children: tokenizeInline(m[1]) })],
    [/^~~([\s\S]+?)~~/, (m) => ({ type: "strike", children: tokenizeInline(m[1]) })],
    [/^\[([^\]]+)\]\(([^)\s]+)\)/, (m) => ({ type: "link", text: m[1], href: sanitizeHref(m[2]) })],
    [/^!\[([^\]]*)\]\(([^)\s]+)\)/, (m) => ({ type: "link", text: m[1] || "image", href: sanitizeHref(m[2]) })],
  ]

  let i = 0
  while (i < text.length) {
    let matched = false
    for (const [pattern, factory] of patterns) {
      pattern.lastIndex = 0
      const sub = text.slice(i)
      const m = pattern.exec(sub)
      if (m && m.index === 0) {
        const result = factory(m)
        if (Array.isArray(result)) tokens.push(...result)
        else tokens.push(result)
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      // Collect non-special text until next possible delimiter
      const next = text.slice(i).search(/[*_`~[\!@]/)
      const take = next === -1 ? text.length - i : next
      const raw = text.slice(i, i + take)
      // scan raw for mentions and auto-urls
      const mentionParts = splitByPattern(raw, MENTION_RE, "mention")
      for (const part of mentionParts) {
        if (part.type === "mention") {
          tokens.push({ type: "mention", username: part.value })
        } else {
          const urlParts = splitByPattern(part.value, URL_RE, "url")
          for (const url of urlParts) {
            if (url.type === "url") tokens.push({ type: "url", href: url.value })
            else tokens.push({ type: "text", text: url.value })
          }
        }
      }
      i += take
    }
  }
  return tokens
}

function splitByPattern(
  text: string,
  pattern: RegExp,
  kind: string
): { type: string; value: string }[] {
  const out: { type: string; value: string }[] = []
  let last = 0
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) })
    out.push({ type: kind, value: kind === "mention" ? m[1] : m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) })
  return out
}

function renderTokens(tokens: MarkdownToken[], keyBase: string): React.ReactNode[] {
  return tokens.map((t, i) => {
    const key = `${keyBase}-${i}`
    switch (t.type) {
      case "text":
        return <span key={key} dangerouslySetInnerHTML={{ __html: escapeForClass(t.text) }} />
      case "bold":
        return <strong key={key}>{renderTokens(t.children, `${key}-b`)}</strong>
      case "italic":
        return <em key={key}>{renderTokens(t.children, `${key}-i`)}</em>
      case "strike":
        return <del key={key}>{renderTokens(t.children, `${key}-s`)}</del>
      case "code":
        return <code key={key} className="px-1 py-0.5 bg-secondary rounded text-sm font-mono">{t.text}</code>
      case "link":
        if (t.href) {
          return <Link key={key} href={t.href} className="text-primary hover:underline break-words" target={t.href.startsWith("http") ? "_blank" : undefined} rel={t.href.startsWith("http") ? "noopener noreferrer" : undefined}>{t.text}</Link>
        }
        return <span key={key}>[{t.text}]</span>
      case "mention":
        return <Link key={key} href={`/u/${t.username}`} className="text-primary hover:underline">@{t.username}</Link>
      case "url":
        return <Link key={key} href={t.href} className="text-primary hover:underline break-words" target="_blank" rel="noopener noreferrer">{t.href}</Link>
    }
  })
}

function parseInlineToNodes(text: string, key: string): React.ReactNode[] {
  return renderTokens(tokenizeInline(text), key)
}

type MarkdownBlock =
  | { type: "heading"; level: number; content: string }
  | { type: "paragraph"; content: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "blank" }

function parseBlocks(input: string): MarkdownBlock[] {
  const lines = input.split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === "") {
      i++
      continue
    }

    // fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push({ type: "code", lang, text: body.join("\n") })
      continue
    }

    // heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2].trim() })
      i++
      continue
    }

    // horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }

    // blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push({ type: "blockquote", lines: quoteLines })
      continue
    }

    // unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""))
        i++
      }
      blocks.push({ type: "ul", items })
      continue
    }

    // ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""))
        i++
      }
      blocks.push({ type: "ol", items })
      continue
    }

    // paragraph (collect until blank)
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== "") {
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ type: "paragraph", content: para.join("\n") })
  }
  return blocks
}

export function MarkdownRenderer({ content }: { content: string }): React.ReactElement {
  const blocks = parseBlocks(content)
  return (
    <>
      {blocks.map((b, i) => {
        const key = `md-${i}`
        switch (b.type) {
          case "heading": {
            const H = (`h${b.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
            const sizeClass = ["text-3xl", "text-2xl", "text-xl", "text-lg", "text-base", "text-sm"][b.level - 1]
            return <H key={key} className={`font-semibold mt-4 mb-2 text-foreground ${sizeClass}`}>{parseInlineToNodes(b.content, key)}</H>
          }
          case "paragraph":
            return <p key={key} className="mb-3 leading-relaxed whitespace-pre-wrap break-words">{parseInlineToNodes(b.content, key)}</p>
          case "blockquote":
            return (
              <blockquote key={key} className="border-l-4 border-primary/50 pl-4 py-1 my-3 italic text-muted-foreground bg-secondary/30 rounded-r-lg">
                {b.lines.map((l, j) => <p key={`${key}-q-${j}`} className="mb-1 last:mb-0">{parseInlineToNodes(l, `${key}-q-${j}`)}</p>)}
              </blockquote>
            )
          case "ul":
            return <ul key={key} className="list-disc pl-5 mb-3 space-y-1">{b.items.map((item, j) => <li key={`${key}-li-${j}`}>{parseInlineToNodes(item, `${key}-li-${j}`)}</li>)}</ul>
          case "ol":
            return <ol key={key} className="list-decimal pl-5 mb-3 space-y-1">{b.items.map((item, j) => <li key={`${key}-li-${j}`}>{parseInlineToNodes(item, `${key}-li-${j}`)}</li>)}</ol>
          case "code":
            return <pre key={key} className="bg-secondary rounded-lg p-3 mb-3 overflow-x-auto text-sm font-mono"><code>{b.text}</code></pre>
          case "hr":
            return <hr key={key} className="my-4 border-border" />
          default:
            return null
        }
      })}
    </>
  )
}
