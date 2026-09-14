import { ProfanityEngine } from "profanity-guard"

// English-only: "all" pulls every supported language's wordlist, which
// false-positives on ordinary English words ("look" was censored in bot
// replies). en still catches real profanity without the Scunthorpe noise.
const engine = new ProfanityEngine({
  language: "en",
  // "balls" is standard cannabis terminology (male pollen sacs / hermie
  // plants — "my plant grew balls") — allowlist it.
  whitelist: ["balls"],
})

export function censorText(text: string): string {
  return engine.censor(text)
}

export function isProfane(text: string): boolean {
  return engine.check(text)
}
