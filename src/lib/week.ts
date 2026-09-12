// ISO week key, e.g. "2026-W37" — used to bucket contest entries
export function currentWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export function previousWeekKey(): string {
  return currentWeekKey(new Date(Date.now() - 7 * 86400000))
}

// Month key, e.g. "2026-05" — used to bucket Diary of the Month entries
export function currentMonthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function previousMonthKey(): string {
  const d = new Date()
  return currentMonthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15)))
}

// UTC [start, end) range for a "YYYY-MM" month key
export function monthRange(key: string): { start: Date; end: Date } {
  const [y, m] = key.split("-").map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  }
}
