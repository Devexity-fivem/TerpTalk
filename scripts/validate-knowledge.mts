// TerpBot knowledge validator — structural lint over the shared
// registries (candidates, rules, sources, contra, refinements, vocab
// feeds, wizard bridge). Prints each error; exits 1 when any exist.
// Run: npm run validate:knowledge

import { validateKnowledge } from "@/lib/terpbot-intel-validate"

const errors = validateKnowledge()
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`)
  console.error(`validate:knowledge — ${errors.length} error(s)`)
  process.exit(1)
}
console.log("validate:knowledge — all registries consistent")
