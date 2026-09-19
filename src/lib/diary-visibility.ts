export const DIARY_VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const
export type DiaryVisibility = (typeof DIARY_VISIBILITIES)[number]
export const DIARY_VISIBILITY_OPTIONS: { value: DiaryVisibility; label: string; help: string }[] = [
  { value: "PUBLIC", label: "Public", help: "Anyone can discover and view this grow." },
  { value: "UNLISTED", label: "Unlisted", help: "Anyone with the link can view it, but it won't appear in public discovery." },
  { value: "PRIVATE", label: "Private", help: "Only you can view it." },
]
export const isDiaryVisibility = (v: unknown): v is DiaryVisibility =>
  typeof v === "string" && (DIARY_VISIBILITIES as readonly string[]).includes(v)
/** Public/discovery surfaces, aggregates, sitemap, search, strain stats. Combine with deleted:false + author: activeAuthor(). */
export const publicDiaryWhere = { visibility: "PUBLIC" } as const
/** Rows a viewer may open by canonical URL: PUBLIC, UNLISTED, or their own. */
export function viewableDiaryWhere(viewerId?: string | null) {
  const open = { visibility: { in: ["PUBLIC", "UNLISTED"] } }
  return viewerId ? { OR: [open, { authorId: viewerId }] } : open
}
export function canViewDiary(d: { visibility: string; authorId: string }, viewerId?: string | null): boolean {
  return d.visibility !== "PRIVATE" || d.authorId === viewerId
}
