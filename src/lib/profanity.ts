import { ProfanityEngine } from "profanity-guard"

const engine = new ProfanityEngine({ language: "all" })

export function censorText(text: string): string {
  return engine.censor(text)
}

export function isProfane(text: string): boolean {
  return engine.check(text)
}
