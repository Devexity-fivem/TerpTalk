import type { ReactNode } from "react"

type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[]
  children?: ReactNode
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data),
      }}
    />
  )
}
