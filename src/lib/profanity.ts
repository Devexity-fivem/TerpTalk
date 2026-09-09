import { Filter } from "bad-words"

const filter = new Filter()

export function censorText(text: string): string {
  return filter.clean(text)
}

export function isProfane(text: string): boolean {
  return filter.isProfane(text)
}
