const UNITS: Array<{ limit: number; seconds: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, seconds: 1, unit: "second" },
  { limit: 3600, seconds: 60, unit: "minute" },
  { limit: 86400, seconds: 3600, unit: "hour" },
  { limit: 604800, seconds: 86400, unit: "day" },
  { limit: 2629800, seconds: 604800, unit: "week" },
  { limit: 31557600, seconds: 2629800, unit: "month" },
]

export function formatRelativeTime(value: string | Date): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ""
  const diffSec = Math.floor((then - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

  if (abs < 45) return "just now"
  for (const { limit, seconds, unit } of UNITS) {
    if (abs < limit) return rtf.format(Math.round(diffSec / seconds), unit)
  }
  return rtf.format(Math.round(diffSec / 31557600), "year")
}
